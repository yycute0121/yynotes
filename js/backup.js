/* ============================================================
   backup.js · 本地备份与恢复
   ------------------------------------------------------------
   导出为标准 ZIP（store 模式，不二次压缩）：
     manifest.json      版本与统计
     data.json          所有业务记录（含 blobId 引用）
     blobs/<id>.<ext>   图片与附件原文件
   用系统解压工具即可直接查看照片，不依赖本应用。

   自己实现 ZIP 的原因：项目不允许引入任何 CDN 或第三方库。
   读取时优先按 store 解析；若文件被外部工具重新压缩成 deflate，
   用浏览器内置的 DecompressionStream 兜底。

   内存策略：打包时逐个文件计算 CRC 后只保留 Blob 引用，
   峰值内存约等于单个最大文件，不会把整库读进内存。
   ============================================================ */
(function (global) {
  'use strict';

  var APP_TAG = 'workbuddy-backup';

  /* ---------------- CRC32 ---------------- */

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------------- 字节工具 ---------------- */

  function u16(v) {
    return new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]);
  }

  function u32(v) {
    return new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]);
  }

  function concat(parts) {
    var total = parts.reduce(function (n, p) { return n + p.length; }, 0);
    var out = new Uint8Array(total);
    var at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  var encoder = new TextEncoder();
  var decoder = new TextDecoder();

  function readU16(view, at) { return view[at] | (view[at + 1] << 8); }
  function readU32(view, at) {
    return (view[at] | (view[at + 1] << 8) | (view[at + 2] << 16) | (view[at + 3] << 24)) >>> 0;
  }

  /** DOS 时间戳 */
  function dosTime(date) {
    var d = date || new Date();
    var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) |
               ((Math.floor(d.getSeconds() / 2)) & 0x1F);
    var day = (((d.getFullYear() - 1980) & 0x7F) << 9) |
              (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
    return { time: time, date: day };
  }

  /* ---------------- 写 ZIP ---------------- */

  function ZipWriter() {
    this.parts = [];    // Blob / Uint8Array 混合，最后交给 Blob 拼接
    this.entries = [];
    this.offset = 0;
  }

  ZipWriter.prototype._push = function (chunk) {
    this.parts.push(chunk);
    this.offset += chunk.length !== undefined ? chunk.length : chunk.size;
  };

  /** blob 为 Blob 或 Uint8Array */
  ZipWriter.prototype.add = function (name, blob) {
    var self = this;
    var data = blob instanceof Blob ? blob : new Blob([blob]);
    return data.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var crc = crc32(bytes);
      var nameBytes = encoder.encode(name);
      var stamp = dosTime();
      var localOffset = self.offset;

      // 0x0808: 使用 UTF-8 文件名标志位（bit 11）
      var header = concat([
        u32(0x04034B50), u16(20), u16(0x0800), u16(0),
        u16(stamp.time), u16(stamp.date),
        u32(crc), u32(bytes.length), u32(bytes.length),
        u16(nameBytes.length), u16(0), nameBytes
      ]);
      self._push(header);
      self._push(bytes);

      self.entries.push({
        name: nameBytes, crc: crc, size: bytes.length,
        offset: localOffset, time: stamp.time, date: stamp.date
      });
    });
  };

  ZipWriter.prototype.build = function () {
    var cdStart = this.offset;
    var central = [];
    this.entries.forEach(function (e) {
      central.push(concat([
        u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(e.time), u16(e.date),
        u32(e.crc), u32(e.size), u32(e.size),
        u16(e.name.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(e.offset), e.name
      ]));
    });
    var cd = concat(central);
    var eocd = concat([
      u32(0x06054B50), u16(0), u16(0),
      u16(this.entries.length), u16(this.entries.length),
      u32(cd.length), u32(cdStart), u16(0)
    ]);
    return new Blob(this.parts.concat([cd, eocd]), { type: 'application/zip' });
  };

  /* ---------------- 读 ZIP ---------------- */

  function inflateRaw(bytes) {
    if (!global.DecompressionStream) {
      return Promise.reject(new Error('这个浏览器无法解析被压缩过的备份，请用原始导出文件'));
    }
    var stream = new Blob([bytes]).stream()
      .pipeThrough(new global.DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (b) {
      return new Uint8Array(b);
    });
  }

  function readZip(file) {
    return file.arrayBuffer().then(function (buf) {
      var view = new Uint8Array(buf);

      // 从尾部回溯定位 EOCD
      var eocd = -1;
      for (var i = view.length - 22; i >= 0 && i > view.length - 65558; i--) {
        if (readU32(view, i) === 0x06054B50) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error('不是有效的 ZIP 备份文件');

      var count = readU16(view, eocd + 10);
      var cdOffset = readU32(view, eocd + 16);

      var files = {};
      var at = cdOffset;
      var tasks = [];

      for (var n = 0; n < count; n++) {
        if (readU32(view, at) !== 0x02014B50) break;
        var method = readU16(view, at + 10);
        var compSize = readU32(view, at + 20);
        var nameLen = readU16(view, at + 28);
        var extraLen = readU16(view, at + 30);
        var commentLen = readU16(view, at + 32);
        var localAt = readU32(view, at + 42);
        var name = decoder.decode(view.subarray(at + 46, at + 46 + nameLen));

        // 跳过 local header 取数据区
        var lNameLen = readU16(view, localAt + 26);
        var lExtraLen = readU16(view, localAt + 28);
        var dataAt = localAt + 30 + lNameLen + lExtraLen;
        var raw = view.subarray(dataAt, dataAt + compSize);

        tasks.push((function (fname, fmethod, fraw) {
          return function () {
            if (fmethod === 0) { files[fname] = fraw; return Promise.resolve(); }
            if (fmethod === 8) {
              return inflateRaw(fraw).then(function (out) { files[fname] = out; });
            }
            return Promise.reject(new Error('备份里有不支持的压缩方式：' + fname));
          };
        })(name, method, raw));

        at += 46 + nameLen + extraLen + commentLen;
      }

      return tasks.reduce(function (chain, task) {
        return chain.then(task);
      }, Promise.resolve()).then(function () { return files; });
    });
  }

  /* ---------------- 导出 ---------------- */

  function extOf(mime) {
    if (!mime) return 'bin';
    if (mime.indexOf('webp') > -1) return 'webp';
    if (mime.indexOf('png') > -1) return 'png';
    if (mime.indexOf('jpeg') > -1 || mime.indexOf('jpg') > -1) return 'jpg';
    if (mime.indexOf('gif') > -1) return 'gif';
    if (mime.indexOf('pdf') > -1) return 'pdf';
    var slash = mime.indexOf('/');
    return slash > -1 ? mime.slice(slash + 1).replace(/[^a-z0-9]/gi, '') || 'bin' : 'bin';
  }

  /**
   * 导出全部数据为 ZIP Blob。
   * onProgress(done, total, label) 用于界面提示。
   */
  function exportAll(onProgress) {
    var S = global.Store.S;
    var report = onProgress || function () {};

    return global.Store.exportRecords().then(function (records) {
      // 收集所有被引用到的 blobId，避免导出孤儿数据
      var wanted = [];
      var seen = {};
      global.Store.businessStores().forEach(function (name) {
        (records[name] || []).forEach(function (row) {
          global.Store.collectBlobIds(name, row).forEach(function (id) {
            if (id && !seen[id]) { seen[id] = 1; wanted.push(id); }
          });
        });
      });

      var counts = {};
      global.Store.businessStores().forEach(function (name) {
        counts[name] = (records[name] || []).length;
      });

      var zip = new ZipWriter();
      var manifest = {
        app: APP_TAG,
        formatVersion: 1,
        schemaVersion: global.Store.SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        counts: counts,
        blobCount: 0,
        note: '本文件由 WorkBuddy 在本机生成，未经任何服务器。blobs 目录下即为原始图片与附件。'
      };

      var blobMeta = [];
      var total = wanted.length + 2;
      var done = 0;

      // 逐个写入图片，避免同时驻留多份二进制
      var chain = Promise.resolve();
      wanted.forEach(function (id) {
        chain = chain.then(function () {
          return global.Store.get(S.blobs, id).then(function (row) {
            if (!row || !row.blob) return null;
            var name = 'blobs/' + id + '.' + extOf(row.type);
            blobMeta.push({
              id: id, path: name, type: row.type || '',
              size: row.size || row.blob.size,
              w: row.w || 0, h: row.h || 0
            });
            return zip.add(name, row.blob);
          }).then(function () {
            done++;
            report(done, total, '打包图片');
          });
        });
      });

      return chain.then(function () {
        manifest.blobCount = blobMeta.length;
        var data = {
          records: records,
          blobs: blobMeta
        };
        return zip.add('data.json', encoder.encode(JSON.stringify(data)));
      }).then(function () {
        done++;
        report(done, total, '写入数据');
        return zip.add('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)));
      }).then(function () {
        done++;
        report(done, total, '完成');
        return { blob: zip.build(), manifest: manifest };
      });
    });
  }

  function fileName() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return 'WorkBuddy备份_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '_' + p(d.getHours()) + p(d.getMinutes()) + '.zip';
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name || fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 稍后释放，确保下载已开始
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ---------------- 导入 ---------------- */

  /** 只解析与校验，不写库。返回 {manifest, payload, summary} */
  function inspect(file) {
    return readZip(file).then(function (files) {
      if (!files['manifest.json'] || !files['data.json']) {
        throw new Error('备份文件不完整，缺少 manifest.json 或 data.json');
      }
      var manifest, data;
      try {
        manifest = JSON.parse(decoder.decode(files['manifest.json']));
        data = JSON.parse(decoder.decode(files['data.json']));
      } catch (e) {
        throw new Error('备份内容无法解析，文件可能已损坏');
      }
      if (manifest.app !== APP_TAG) {
        throw new Error('这不是 WorkBuddy 的备份文件');
      }
      if (Number(manifest.schemaVersion) > global.Store.SCHEMA_VERSION) {
        throw new Error('备份来自更新版本的应用，请先升级后再导入');
      }

      // 还原 Blob 记录
      var blobs = [];
      var missing = [];
      (data.blobs || []).forEach(function (b) {
        var bytes = files[b.path];
        if (!bytes) { missing.push(b.path); return; }
        blobs.push({
          id: b.id,
          blob: new Blob([bytes], { type: b.type || 'application/octet-stream' }),
          type: b.type || '',
          size: b.size || bytes.length,
          w: b.w || 0,
          h: b.h || 0
        });
      });

      var summary = [];
      var labels = {
        clothes: '衣物', wishlist: '想买清单', avatars: '人物素材',
        outfits: '搭配方案', devices: '电子物品', notes: '随手笔记',
        projects: '重大事件', inventory: '库存商品'
      };
      Object.keys(labels).forEach(function (k) {
        var n = ((data.records || {})[k] || []).length;
        if (n) summary.push({ label: labels[k], count: n });
      });

      return {
        manifest: manifest,
        payload: { records: data.records || {}, blobs: blobs },
        summary: summary,
        images: blobs.length,
        missing: missing
      };
    });
  }

  function restore(payload, mode) {
    return global.Store.importAll(payload, mode);
  }

  global.Backup = {
    exportAll: exportAll,
    inspect: inspect,
    restore: restore,
    download: download,
    fileName: fileName,
    // 供测试用
    _crc32: crc32,
    _ZipWriter: ZipWriter,
    _readZip: readZip
  };
})(window);
