/* ============================================================
   ui.js · 通用组件与工具
   图标全部内联 SVG，不引用任何图标库或远程字体。
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 图标 ---------------- */
  var PATHS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    chevron: '<path d="M9 18l6-6-6-6"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5-11 11"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
    shirt: '<path d="M8 3l4 2 4-2 4 3-2.5 3V21H6.5V9L4 6z"/>',
    heart: '<path d="M12 20s-7-4.6-7-9.6A3.9 3.9 0 0112 8a3.9 3.9 0 017 2.4c0 5-7 9.6-7 9.6z"/>',
    person: '<circle cx="12" cy="7" r="3.6"/><path d="M5 21c0-4 3.2-7 7-7s7 3 7 7"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    device: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/>',
    note: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
    box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    resize: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-8 8"/><path d="M3 21l8-8"/>',
    up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
    save: '<path d="M19 21H5V3h11l3 3z"/><path d="M8 3v6h8"/>',
    magic: '<path d="M5 19l9-9"/><path d="M15 5l1.5 3.5L20 10l-3.5 1.5L15 15l-1.5-3.5L10 10l3.5-1.5z"/>',
    link: '<path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    data: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'
  };

  function icon(name, size) {
    var d = PATHS[name] || '';
    var s = size || 20;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + d + '</svg>';
  }

  /* ---------------- 文本工具 ---------------- */

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(v) {
    if (v === '' || v === null || v === undefined || isNaN(v)) return '';
    var n = Number(v);
    return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function bytes(n) {
    if (!n) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  /** 用本地时区解析 yyyy-MM-dd，避免 UTC 造成日期偏一天 */
  function parseLocalDate(str) {
    if (!str) return null;
    var m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function todayLocal() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function dateStr(d) {
    var x = d || new Date();
    var mm = String(x.getMonth() + 1).padStart(2, '0');
    var dd = String(x.getDate()).padStart(2, '0');
    return x.getFullYear() + '-' + mm + '-' + dd;
  }

  function daysBetween(from, to) {
    if (!from || !to) return null;
    return Math.round((to - from) / 86400000);
  }

  function fmtDate(str) {
    var d = parseLocalDate(str);
    if (!d) return '未设置';
    return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') +
      '.' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------------- Toast ---------------- */

  var toastRoot = null;
  function toast(msg, kind) {
    if (!toastRoot) toastRoot = document.getElementById('toast-root');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.textContent = msg;
    toastRoot.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, kind === 'err' ? 2600 : 1900);
  }

  /* ---------------- 底部抽屉 ---------------- */

  var sheetRoot = null;
  var sheetStack = [];

  /**
   * 栈式底部抽屉：可层叠，closeSheet 只关最顶层。
   * 表单里再打开图片选择器时，表单不会被销毁，草稿状态得以保留。
   */
  function sheet(config) {
    if (!sheetRoot) sheetRoot = document.getElementById('sheet-root');

    var opts = config || {};
    var layer = document.createElement('div');
    layer.className = 'sheet-layer';

    var wrap = document.createElement('div');
    wrap.className = 'sheet';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');

    var footHtml = '';
    if (opts.actions && opts.actions.length) {
      footHtml = '<div class="sheet-foot">' + opts.actions.map(function (a, i) {
        return '<button type="button" class="btn ' + (a.className || 'btn--soft') +
          '" data-action="' + i + '">' + esc(a.label) + '</button>';
      }).join('') + '</div>';
    }

    wrap.innerHTML =
      '<div class="sheet-grip"><span></span></div>' +
      '<div class="sheet-head">' +
        '<h2>' + esc(opts.title || '') + '</h2>' +
        '<button type="button" class="icon-btn" data-close="1" aria-label="关闭">' + icon('close', 18) + '</button>' +
      '</div>' +
      '<div class="sheet-body"></div>' + footHtml;

    var mask = document.createElement('div');
    mask.className = 'sheet-mask';

    layer.appendChild(mask);
    layer.appendChild(wrap);
    sheetRoot.appendChild(layer);

    var body = wrap.querySelector('.sheet-body');
    if (typeof opts.content === 'string') body.innerHTML = opts.content;
    else if (opts.content) body.appendChild(opts.content);

    var entry = { layer: layer, wrap: wrap, body: body, opts: opts };
    sheetStack.push(entry);

    requestAnimationFrame(function () {
      sheetRoot.classList.add('is-open');
      layer.classList.add('is-open');
    });

    var closeThis = function () { closeLayer(entry); };

    mask.addEventListener('click', closeThis);
    wrap.querySelector('[data-close]').addEventListener('click', closeThis);

    if (opts.actions) {
      wrap.querySelectorAll('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var action = opts.actions[Number(btn.dataset.action)];
          if (action && action.onClick) action.onClick(body, closeThis);
          else closeThis();
        });
      });
    }

    enableGripDrag(wrap, closeThis);
    if (opts.onOpen) opts.onOpen(body, closeThis);
    return { body: body, close: closeThis };
  }

  function closeLayer(entry, immediate) {
    var idx = sheetStack.indexOf(entry);
    if (idx === -1) return;
    sheetStack.splice(idx, 1);
    entry.layer.classList.remove('is-open');
    if (!sheetStack.length) sheetRoot.classList.remove('is-open');

    var done = function () {
      entry.layer.remove();
      if (entry.opts.onClose) entry.opts.onClose();
    };
    immediate ? done() : setTimeout(done, 280);
  }

  /** 抓手下滑关闭，纯 transform 位移，不触发重排 */
  function enableGripDrag(wrap, closeThis) {
    var grip = wrap.querySelector('.sheet-grip');
    var startY = 0, delta = 0, dragging = false;

    grip.addEventListener('pointerdown', function (e) {
      dragging = true;
      startY = e.clientY;
      delta = 0;
      wrap.style.transition = 'none';
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      delta = Math.max(0, e.clientY - startY);
      wrap.style.transform = 'translateY(' + delta + 'px)';
    });
    function end() {
      if (!dragging) return;
      dragging = false;
      wrap.style.transition = '';
      wrap.style.transform = '';
      if (delta > 110) closeThis();
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  /** 关闭最顶层抽屉；immediate=true 时清空整个栈（用于路由切换） */
  function closeSheet(immediate) {
    if (!sheetStack.length) return;
    if (immediate) {
      sheetStack.slice().forEach(function (entry) { closeLayer(entry, true); });
      return;
    }
    closeLayer(sheetStack[sheetStack.length - 1]);
  }

  /* ---------------- 确认框 ---------------- */

  function confirm(config) {
    var opts = config || {};
    return new Promise(function (resolve) {
      var settled = false;
      sheet({
        title: opts.title || '确认操作',
        content: '<p style="margin:0;color:var(--ink-2);font-size:13.5px;line-height:1.7">' +
          esc(opts.message || '') + '</p>' +
          (opts.detail ? '<p style="margin:12px 0 0;font-size:12px;color:var(--ink-faint)">' +
            esc(opts.detail) + '</p>' : ''),
        actions: [
          {
            label: opts.cancelText || '取消',
            className: 'btn--ghost',
            onClick: function (b, close) { settled = true; resolve(false); close(); }
          },
          {
            label: opts.confirmText || '确认',
            className: opts.danger ? 'btn--danger' : 'btn--primary',
            onClick: function (b, close) { settled = true; resolve(true); close(); }
          }
        ],
        onClose: function () { if (!settled) resolve(false); }
      });
    });
  }

  /* ---------------- 图片查看器 ---------------- */

  function viewer(url) {
    if (!url) return;
    var root = document.getElementById('viewer-root');
    root.innerHTML = '<button type="button" class="viewer-close" aria-label="关闭">' +
      icon('close', 20) + '</button><img src="' + esc(url) + '" alt="图片预览">';
    root.hidden = false;
    function close() { root.hidden = true; root.innerHTML = ''; }
    root.querySelector('.viewer-close').addEventListener('click', close);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
  }

  /* ---------------- 缩略图懒加载 ---------------- */

  var observer = null;

  function ensureObserver() {
    if (observer || !global.IntersectionObserver) return;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        observer.unobserve(el);
        hydrate(el);
      });
    }, { rootMargin: '160px 0px' });
  }

  function hydrate(el) {
    var blobId = el.dataset.blob;
    var group = el.dataset.group || 'global';
    if (!blobId) return;
    global.Img.url(blobId, group).then(function (url) {
      if (!url || !el.isConnected) return;
      el.src = url;
      el.classList.add('is-loaded');
    });
  }

  /**
   * 扫描容器内所有 img[data-blob]，按需懒加载。
   * 列表只加载缩略图，滚动进入视口才解码，控制峰值内存。
   */
  function bindLazyImages(container) {
    ensureObserver();
    var nodes = (container || document).querySelectorAll('img[data-blob]:not([data-bound])');
    nodes.forEach(function (el) {
      el.dataset.bound = '1';
      if (observer) observer.observe(el);
      else hydrate(el);
    });
  }

  /* ---------------- DOM 小工具 ---------------- */

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function on(root, selector, event, handler) {
    (root || document).querySelectorAll(selector).forEach(function (node) {
      node.addEventListener(event, handler);
    });
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 220);
    };
  }

  global.UI = {
    icon: icon,
    esc: esc,
    money: money,
    bytes: bytes,
    parseLocalDate: parseLocalDate,
    todayLocal: todayLocal,
    dateStr: dateStr,
    daysBetween: daysBetween,
    fmtDate: fmtDate,
    toast: toast,
    sheet: sheet,
    closeSheet: closeSheet,
    confirm: confirm,
    viewer: viewer,
    bindLazyImages: bindLazyImages,
    el: el,
    on: on,
    debounce: debounce
  };
})(window);
