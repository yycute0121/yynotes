/* ============================================================
   service-worker.js · 离线支持
   ------------------------------------------------------------
   只缓存本应用自身的静态资源（App Shell），不缓存任何远程内容。
   用户数据保存在 IndexedDB，不经过这里，也不会被上传。
   ============================================================ */

/* 改动样式或脚本后必须提升这个版本号：
   activate 阶段会删除所有非当前版本的缓存，避免用户拿到旧资源。 */
var CACHE = 'workbuddy-v7';

var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/theme.css',
  './css/app.css',
  './js/store.js',
  './js/image.js',
  './js/ui.js',
  './js/common.js',
  './js/backup.js',
  './js/health.js',
  './js/wardrobe.js',
  './js/devices.js',
  './js/inventory.js',
  './js/events.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 单个资源失败不应阻断整体安装
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // 只接管同源资源，第三方请求一律放行（本应用不主动发起）
  if (url.origin !== location.origin) return;

  // 导航请求：网络优先，断网回落到缓存的入口页
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || new Response('离线状态下未找到缓存页面', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  // 静态资源：缓存优先，后台顺带更新
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        fetch(req).then(function (res) {
          if (res && res.ok) {
            caches.open(CACHE).then(function (c) { c.put(req, res); });
          }
        }).catch(function () { /* 离线时忽略 */ });
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
