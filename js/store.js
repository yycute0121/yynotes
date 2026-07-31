/* ============================================================
   store.js · 本地数据层（IndexedDB）
   ------------------------------------------------------------
   内存策略要点：
   1. 图片二进制单独放在 blobs 表，业务表只存 blobId 引用。
      列表查询因此只加载轻量元数据，不会把几十张大图读进内存。
   2. 每张图存两份：thumb（列表用，短边压到 320）与 full（详情/画布用）。
   3. 所有数据只写本机，不发起任何网络请求。
   ============================================================ */
(function (global) {
  'use strict';

  var DB_NAME = 'workbuddy';
  var DB_VERSION = 2;
  var SCHEMA_VERSION = 2;

  var STORES = {
    meta: 'meta',
    blobs: 'blobs',
    // 电子衣柜
    clothes: 'clothes',
    wishlist: 'wishlist',
    avatars: 'avatars',
    outfits: 'outfits',
    // 电子物品档案
    devices: 'devices',
    // 事件记录本：随手一记与重大事件项目
    notes: 'notes',
    projects: 'projects',
    // 生活用品库存
    inventory: 'inventory'
  };

  /* 业务表 → 其引用图片字段的映射，供删除回收与备份使用。
     数组型字段（多图、附件）以 [] 后缀标注。 */
  var BLOB_FIELDS = {
    clothes: ['fullId', 'thumbId'],
    wishlist: ['fullId', 'thumbId'],
    avatars: ['fullId', 'thumbId'],
    outfits: ['previewId'],
    devices: ['photos[]'],
    notes: ['images[]'],
    projects: ['coverFullId', 'coverThumbId', 'attachments[]', 'logs[]'],
    inventory: []
  };

  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('当前浏览器不支持 IndexedDB，无法本地保存数据'));
        return;
      }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (event) {
        var db = req.result;
        var tx = event.target.transaction;

        if (!db.objectStoreNames.contains(STORES.meta)) {
          db.createObjectStore(STORES.meta, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORES.blobs)) {
          db.createObjectStore(STORES.blobs, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.clothes)) {
          var cs = db.createObjectStore(STORES.clothes, { keyPath: 'id' });
          cs.createIndex('createdAt', 'createdAt');
          cs.createIndex('category', 'category');
        }
        if (!db.objectStoreNames.contains(STORES.wishlist)) {
          var ws = db.createObjectStore(STORES.wishlist, { keyPath: 'id' });
          ws.createIndex('createdAt', 'createdAt');
          ws.createIndex('status', 'status');
        }
        if (!db.objectStoreNames.contains(STORES.avatars)) {
          var as = db.createObjectStore(STORES.avatars, { keyPath: 'id' });
          as.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(STORES.outfits)) {
          var os = db.createObjectStore(STORES.outfits, { keyPath: 'id' });
          os.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(STORES.devices)) {
          var ds = db.createObjectStore(STORES.devices, { keyPath: 'id' });
          ds.createIndex('createdAt', 'createdAt');
          ds.createIndex('category', 'category');
        }
        if (!db.objectStoreNames.contains(STORES.notes)) {
          var ns = db.createObjectStore(STORES.notes, { keyPath: 'id' });
          ns.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(STORES.projects)) {
          var ps = db.createObjectStore(STORES.projects, { keyPath: 'id' });
          ps.createIndex('updatedAt', 'updatedAt');
          ps.createIndex('category', 'category');
        }
        if (!db.objectStoreNames.contains(STORES.inventory)) {
          var ivs = db.createObjectStore(STORES.inventory, { keyPath: 'id' });
          ivs.createIndex('createdAt', 'createdAt');
          ivs.createIndex('category', 'category');
        }

        tx.oncomplete = function () {
          var mtx = db.transaction(STORES.meta, 'readwrite');
          mtx.objectStore(STORES.meta).put({ key: 'schemaVersion', value: SCHEMA_VERSION });
        };
      };

      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('数据库打开失败')); };
      req.onblocked = function () { reject(new Error('数据库被其他标签页占用，请关闭后重试')); };
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return openDB().then(function (db) {
      return db.transaction(storeName, mode).objectStore(storeName);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /* ---------------- 通用读写 ---------------- */

  function get(storeName, id) {
    return tx(storeName, 'readonly').then(function (s) { return wrap(s.get(id)); });
  }

  function getAll(storeName) {
    return tx(storeName, 'readonly').then(function (s) { return wrap(s.getAll()); });
  }

  function put(storeName, value) {
    return tx(storeName, 'readwrite').then(function (s) {
      return wrap(s.put(value)).then(function () { return value; });
    });
  }

  function del(storeName, id) {
    return tx(storeName, 'readwrite').then(function (s) { return wrap(s.delete(id)); });
  }

  function count(storeName) {
    return tx(storeName, 'readonly').then(function (s) { return wrap(s.count()); });
  }

  function clearStore(storeName) {
    return tx(storeName, 'readwrite').then(function (s) { return wrap(s.clear()); });
  }

  /* ---------------- meta ---------------- */

  function getMeta(key, fallback) {
    return get(STORES.meta, key).then(function (row) {
      return row && row.value !== undefined ? row.value : fallback;
    });
  }

  function setMeta(key, value) {
    return put(STORES.meta, { key: key, value: value });
  }

  /* ---------------- blobs ---------------- */

  function putBlob(record) {
    // record: {id, blob, type, size, w, h}
    return put(STORES.blobs, record).then(function () { return record.id; });
  }

  function getBlob(id) {
    if (!id) return Promise.resolve(null);
    return get(STORES.blobs, id).then(function (row) {
      return row && row.blob ? row.blob : null;
    });
  }

  function delBlob(id) {
    if (!id) return Promise.resolve();
    return del(STORES.blobs, id);
  }

  function delBlobs(ids) {
    var list = (ids || []).filter(Boolean);
    if (!list.length) return Promise.resolve();
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORES.blobs, 'readwrite');
        var s = t.objectStore(STORES.blobs);
        list.forEach(function (id) { s.delete(id); });
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /* ---------------- 工具 ---------------- */

  function uid(prefix) {
    var rand = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '_' + Date.now().toString(36) + rand;
  }

  function estimate() {
    if (!navigator.storage || !navigator.storage.estimate) {
      return Promise.resolve(null);
    }
    return navigator.storage.estimate().then(function (r) {
      return { usage: r.usage || 0, quota: r.quota || 0 };
    }).catch(function () { return null; });
  }

  /**
   * 收集一条记录引用的所有 blobId。
   * 支持三种形态：普通字段、数组字段（多图/附件）、数组内嵌对象。
   */
  function collectBlobIds(storeName, row) {
    var spec = BLOB_FIELDS[storeName] || [];
    var ids = [];
    spec.forEach(function (field) {
      if (field.slice(-2) === '[]') {
        var arr = row[field.slice(0, -2)];
        if (!Array.isArray(arr)) return;
        arr.forEach(function (item) {
          if (typeof item === 'string') { ids.push(item); return; }
          if (!item) return;
          ['fullId', 'thumbId', 'blobId', 'imageId'].forEach(function (k) {
            if (item[k]) ids.push(item[k]);
          });
        });
      } else if (row[field]) {
        ids.push(row[field]);
      }
    });
    return ids;
  }

  /** 删除一条记录，同时回收它引用的图片，避免孤儿 Blob 占配额 */
  function removeRecord(storeName, row) {
    if (!row) return Promise.resolve();
    return delBlobs(collectBlobIds(storeName, row)).then(function () {
      return del(storeName, row.id);
    });
  }

  /** 清空指定业务表，同时回收其引用的所有图片 */
  function purgeStore(storeName) {
    return getAll(storeName).then(function (rows) {
      var ids = [];
      rows.forEach(function (row) {
        ids = ids.concat(collectBlobIds(storeName, row));
      });
      return delBlobs(ids).then(function () { return clearStore(storeName); });
    });
  }

  function businessStores() {
    return Object.keys(BLOB_FIELDS);
  }

  /** 导出所有业务表记录（不含二进制，Blob 由调用方按 id 取） */
  function exportRecords() {
    var names = businessStores();
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(names.concat([STORES.meta]), 'readonly');
        var out = {};
        names.concat([STORES.meta]).forEach(function (name) {
          var req = t.objectStore(name).getAll();
          req.onsuccess = function () { out[name] = req.result || []; };
        });
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /**
   * 单事务导入。全部写入成功才提交，任一步失败自动回滚，
   * 因此导入失败不会破坏现有数据。
   * mode: 'replace' 先清空同名表，'merge' 按 id 覆盖或追加。
   */
  function importAll(payload, mode) {
    var names = businessStores();
    var blobs = payload.blobs || [];
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var all = names.concat([STORES.blobs, STORES.meta]);
        var t = db.transaction(all, 'readwrite');
        var written = { records: 0, blobs: 0 };

        t.oncomplete = function () { resolve(written); };
        t.onerror = function () { reject(t.error || new Error('导入失败，已回滚')); };
        t.onabort = function () { reject(t.error || new Error('导入被中断，已回滚')); };

        try {
          if (mode === 'replace') {
            names.concat([STORES.blobs]).forEach(function (name) {
              t.objectStore(name).clear();
            });
          }
          blobs.forEach(function (b) {
            t.objectStore(STORES.blobs).put(b);
            written.blobs++;
          });
          names.forEach(function (name) {
            var rows = payload.records && payload.records[name];
            if (!Array.isArray(rows)) return;
            var store = t.objectStore(name);
            rows.forEach(function (row) {
              if (row && row.id) { store.put(row); written.records++; }
            });
          });
          // 分类等自定义配置一并恢复
          var metaRows = payload.records && payload.records[STORES.meta];
          if (Array.isArray(metaRows)) {
            metaRows.forEach(function (row) {
              if (row && row.key && row.key !== 'schemaVersion') {
                t.objectStore(STORES.meta).put(row);
              }
            });
          }
        } catch (err) {
          try { t.abort(); } catch (e) { /* 忽略 */ }
          reject(err);
        }
      });
    });
  }

  global.Store = {
    S: STORES,
    BLOB_FIELDS: BLOB_FIELDS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    open: openDB,
    collectBlobIds: collectBlobIds,
    removeRecord: removeRecord,
    businessStores: businessStores,
    exportRecords: exportRecords,
    importAll: importAll,
    get: get,
    getAll: getAll,
    put: put,
    del: del,
    count: count,
    clearStore: clearStore,
    purgeStore: purgeStore,
    getMeta: getMeta,
    setMeta: setMeta,
    putBlob: putBlob,
    getBlob: getBlob,
    delBlob: delBlob,
    delBlobs: delBlobs,
    uid: uid,
    estimate: estimate
  };
})(window);
