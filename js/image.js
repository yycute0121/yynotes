/* ============================================================
   image.js · 本地图片处理
   ------------------------------------------------------------
   内存策略要点：
   1. 入口即压缩：任何图片先降到 FULL_MAX 再落库，原始大图不进 IndexedDB。
   2. 双份产物：full（详情/画布）+ thumb（列表），列表永不加载 full。
   3. ImageBitmap 用完立刻 close()，canvas 用完把宽高置 0 让浏览器回收显存。
   4. ObjectURL 引用计数管理，切页时按 group 批量 revoke，避免泄漏。
   5. 抠图在压缩后的图上跑，像素量可控，用队列而非递归避免爆栈。
   全流程零网络请求。
   ============================================================ */
(function (global) {
  'use strict';

  var FULL_MAX = 1280;   // 落库长边上限
  var THUMB_MAX = 320;   // 缩略图长边
  var PREVIEW_MAX = 900; // 编辑预览长边
  var MAX_INPUT_BYTES = 20 * 1024 * 1024;

  var supportCache = {};

  function supportsType(type) {
    if (supportCache[type] !== undefined) return supportCache[type];
    var c = document.createElement('canvas');
    c.width = c.height = 1;
    var ok = false;
    try { ok = c.toDataURL(type).indexOf('data:' + type) === 0; } catch (e) { ok = false; }
    c.width = c.height = 0;
    supportCache[type] = ok;
    return ok;
  }

  function bestType(needAlpha) {
    if (supportsType('image/webp')) return 'image/webp';
    return needAlpha ? 'image/png' : 'image/jpeg';
  }

  /* ---------------- 解码 ---------------- */

  function decode(file) {
    if (!file) return Promise.reject(new Error('没有选择图片'));
    if (file.size > MAX_INPUT_BYTES) {
      return Promise.reject(new Error('图片超过 20MB，请先压缩或换一张'));
    }
    if (global.createImageBitmap) {
      return global.createImageBitmap(file).catch(function () { return decodeViaImg(file); });
    }
    return decodeViaImg(file);
  }

  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片解码失败，可能格式不受支持'));
      };
      img.src = url;
    });
  }

  function sizeOf(source) {
    return {
      w: source.width || source.naturalWidth || 0,
      h: source.height || source.naturalHeight || 0
    };
  }

  function release(source) {
    if (source && typeof source.close === 'function') {
      try { source.close(); } catch (e) { /* 忽略 */ }
    }
  }

  function disposeCanvas(canvas) {
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
  }

  /* ---------------- 缩放 ---------------- */

  function fit(w, h, max) {
    if (!w || !h) return { w: max, h: max };
    if (w <= max && h <= max) return { w: w, h: h };
    var ratio = w > h ? max / w : max / h;
    return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)) };
  }

  function drawTo(source, max) {
    var s = sizeOf(source);
    var target = fit(s.w, s.h, max);
    var canvas = document.createElement('canvas');
    canvas.width = target.w;
    canvas.height = target.h;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, target.w, target.h);
    return canvas;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          blob ? resolve(blob) : reject(new Error('图片编码失败'));
        }, type, quality);
      } else {
        try {
          var parts = canvas.toDataURL(type, quality).split(',');
          var bin = atob(parts[1]);
          var buf = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          resolve(new Blob([buf], { type: type }));
        } catch (e) { reject(new Error('图片编码失败')); }
      }
    });
  }

  /**
   * 把任意来源（File / Canvas / Bitmap）压成 full + thumb 两个 Blob。
   * 返回 {full, thumb, w, h, type}
   */
  function makeVariants(source, options) {
    var opts = options || {};
    var needAlpha = !!opts.alpha;
    var type = bestType(needAlpha);
    var quality = needAlpha ? 0.92 : (opts.quality || 0.84);

    var fullCanvas = drawTo(source, opts.fullMax || FULL_MAX);
    var thumbCanvas = drawTo(fullCanvas, THUMB_MAX);

    return canvasToBlob(fullCanvas, type, quality).then(function (fullBlob) {
      return canvasToBlob(thumbCanvas, type, 0.78).then(function (thumbBlob) {
        var result = {
          full: fullBlob,
          thumb: thumbBlob,
          w: fullCanvas.width,
          h: fullCanvas.height,
          type: type
        };
        disposeCanvas(fullCanvas);
        disposeCanvas(thumbCanvas);
        return result;
      });
    });
  }

  /**
   * 把图片存入 IndexedDB，返回 {fullId, thumbId, w, h}
   */
  function persist(source, options) {
    return makeVariants(source, options).then(function (v) {
      var fullId = global.Store.uid('img');
      var thumbId = global.Store.uid('thb');
      return global.Store.putBlob({
        id: fullId, blob: v.full, type: v.type,
        size: v.full.size, w: v.w, h: v.h
      }).then(function () {
        return global.Store.putBlob({
          id: thumbId, blob: v.thumb, type: v.type, size: v.thumb.size
        });
      }).then(function () {
        return { fullId: fullId, thumbId: thumbId, w: v.w, h: v.h, bytes: v.full.size + v.thumb.size };
      });
    });
  }

  /* ---------------- 本地抠图 ---------------- */

  /**
   * 纯本地去背：从四边向内做容差 flood fill，去掉与背景相近的连通区域。
   * 适合白底或纯色底的电商图与摆拍图；不调用任何云端接口，也不加载 AI 模型。
   * tolerance: 0-100
   */
  function removeBackground(source, tolerance) {
    var canvas = drawTo(source, PREVIEW_MAX);
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var imageData = ctx.getImageData(0, 0, w, h);
    var data = imageData.data;

    var tol = Math.max(1, Math.min(100, tolerance || 28));
    // 阈值按欧氏距离平方计算，映射到 0-255 空间
    var limit = Math.pow(tol * 2.55, 2) * 3;

    var bg = sampleBorderColor(data, w, h);

    var total = w * h;
    var visited = new Uint8Array(total);
    var queue = new Int32Array(total);
    var head = 0, tail = 0;

    function pushIfBg(idx) {
      if (visited[idx]) return;
      visited[idx] = 1;
      var p = idx * 4;
      var dr = data[p] - bg.r;
      var dg = data[p + 1] - bg.g;
      var db = data[p + 2] - bg.b;
      if (dr * dr + dg * dg + db * db <= limit) {
        data[p + 3] = 0;
        queue[tail++] = idx;
      }
    }

    for (var x = 0; x < w; x++) {
      pushIfBg(x);
      pushIfBg((h - 1) * w + x);
    }
    for (var y = 0; y < h; y++) {
      pushIfBg(y * w);
      pushIfBg(y * w + w - 1);
    }

    while (head < tail) {
      var cur = queue[head++];
      var cx = cur % w;
      var cy = (cur - cx) / w;
      if (cx > 0) pushIfBg(cur - 1);
      if (cx < w - 1) pushIfBg(cur + 1);
      if (cy > 0) pushIfBg(cur - w);
      if (cy < h - 1) pushIfBg(cur + w);
    }

    featherAlpha(data, w, h);
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function sampleBorderColor(data, w, h) {
    var rs = [], gs = [], bs = [];
    var step = Math.max(1, Math.floor(w / 40));
    function take(x, y) {
      var p = (y * w + x) * 4;
      rs.push(data[p]); gs.push(data[p + 1]); bs.push(data[p + 2]);
    }
    for (var x = 0; x < w; x += step) { take(x, 0); take(x, h - 1); }
    var stepY = Math.max(1, Math.floor(h / 40));
    for (var y = 0; y < h; y += stepY) { take(0, y); take(w - 1, y); }
    return { r: median(rs), g: median(gs), b: median(bs) };
  }

  function median(arr) {
    arr.sort(function (a, b) { return a - b; });
    return arr[Math.floor(arr.length / 2)] || 0;
  }

  /** 对 alpha 通道做一次轻羽化，缓解抠图硬边 */
  function featherAlpha(data, w, h) {
    var alpha = new Uint8ClampedArray(w * h);
    var i, idx;
    for (i = 0, idx = 0; idx < w * h; idx++, i += 4) alpha[idx] = data[i + 3];

    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var c = y * w + x;
        var a = alpha[c];
        // 只处理边界像素，内部保持原样，减少不必要计算
        if (a === alpha[c - 1] && a === alpha[c + 1] &&
            a === alpha[c - w] && a === alpha[c + w]) continue;
        var sum = alpha[c] + alpha[c - 1] + alpha[c + 1] + alpha[c - w] + alpha[c + w] +
                  alpha[c - w - 1] + alpha[c - w + 1] + alpha[c + w - 1] + alpha[c + w + 1];
        data[c * 4 + 3] = Math.round(sum / 9);
      }
    }
  }

  /** 按矩形裁剪（比例为 0-1 的相对值） */
  function crop(source, rect) {
    var s = sizeOf(source);
    var sx = Math.round(rect.x * s.w);
    var sy = Math.round(rect.y * s.h);
    var sw = Math.max(1, Math.round(rect.w * s.w));
    var sh = Math.max(1, Math.round(rect.h * s.h));
    var canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas;
  }

  /* ---------------- ObjectURL 引用计数 ---------------- */

  var urlMap = new Map();   // blobId -> {url, group}
  var pending = new Map();  // blobId -> Promise

  /**
   * 取得某个 blobId 的可用 URL。group 用于批量回收（通常传路由名）。
   */
  function url(blobId, group) {
    if (!blobId) return Promise.resolve('');
    var hit = urlMap.get(blobId);
    if (hit) return Promise.resolve(hit.url);
    if (pending.has(blobId)) return pending.get(blobId);

    var task = global.Store.getBlob(blobId).then(function (blob) {
      pending.delete(blobId);
      if (!blob) return '';
      var existing = urlMap.get(blobId);
      if (existing) return existing.url;
      var objectUrl = URL.createObjectURL(blob);
      urlMap.set(blobId, { url: objectUrl, group: group || 'global' });
      return objectUrl;
    }).catch(function () {
      pending.delete(blobId);
      return '';
    });

    pending.set(blobId, task);
    return task;
  }

  function releaseOne(blobId) {
    var hit = urlMap.get(blobId);
    if (!hit) return;
    URL.revokeObjectURL(hit.url);
    urlMap.delete(blobId);
  }

  /** 切换页面时回收该页产生的所有 URL */
  function releaseGroup(group) {
    urlMap.forEach(function (v, k) {
      if (v.group === group) {
        URL.revokeObjectURL(v.url);
        urlMap.delete(k);
      }
    });
  }

  function releaseAll() {
    urlMap.forEach(function (v) { URL.revokeObjectURL(v.url); });
    urlMap.clear();
  }

  function liveUrlCount() { return urlMap.size; }

  global.Img = {
    FULL_MAX: FULL_MAX,
    THUMB_MAX: THUMB_MAX,
    decode: decode,
    sizeOf: sizeOf,
    release: release,
    disposeCanvas: disposeCanvas,
    drawTo: drawTo,
    canvasToBlob: canvasToBlob,
    makeVariants: makeVariants,
    persist: persist,
    removeBackground: removeBackground,
    crop: crop,
    url: url,
    releaseOne: releaseOne,
    releaseGroup: releaseGroup,
    releaseAll: releaseAll,
    liveUrlCount: liveUrlCount
  };
})(window);
