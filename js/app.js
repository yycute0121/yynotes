/* ============================================================
   app.js · 路由与页面外壳
   纯前端 Hash 路由，兼容 GitHub Pages 子路径部署与离线打开。
   ============================================================ */
(function (global) {
  'use strict';

  var UI = global.UI;
  var S = global.Store.S;
  var host = null;

  var TABS = [
    { key: 'closet', label: '我的衣橱' },
    { key: 'wishlist', label: '想买清单' },
    { key: 'avatars', label: '数字人物' },
    { key: 'outfits', label: '搭配画布' }
  ];

  /* ---------------- 问候语 ---------------- */

  function greeting() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return '早上好，今天想做点什么';
    if (h >= 12 && h < 18) return '下午好，今天想做点什么';
    return '晚上好，今天想做点什么';
  }

  /* ---------------- 首页 ---------------- */

  function renderHome() {
    host.innerHTML = '<div class="loading">正在打开本地数据...</div>';

    var zero = function () { return 0; };
    return Promise.all([
      global.Store.count(S.clothes).catch(zero),
      global.Store.count(S.wishlist).catch(zero),
      global.Store.count(S.outfits).catch(zero),
      global.Devices.list().catch(function () { return []; }),
      global.Store.count(S.notes).catch(zero),
      global.Events.listProjects().catch(function () { return []; }),
      global.Inventory.list().catch(function () { return []; })
    ]).then(function (r) {
      var devices = r[3];
      var projects = r[5];
      var stock = r[6];

      // 首页只显示需要注意的数字，避免变成第二个列表页
      var warnWarranty = devices.filter(function (d) {
        var n = global.Common.Days.until(d.warrantyDate);
        return n !== null && n >= 0 && n <= 30;
      }).length;
      var activeProjects = projects.filter(function (p) {
        return global.Events.progress(p).pct < 100;
      }).length;
      var expiring = stock.filter(global.Inventory.isExpiring).length;
      var restock = stock.filter(global.Inventory.needRestock).length;

      var cards = [
        {
          key: 'devices', icon: 'device', cls: 'tool-card--devices',
          title: '电子物品档案', desc: '数码设备、配件统一存档',
          meta: devices.length
            ? devices.length + ' 台设备' + (warnWarranty ? ' · ' + warnWarranty + ' 台保修将到期' : '')
            : '记录购入信息与保修，自动算使用天数',
          href: '#/devices'
        },
        {
          key: 'events', icon: 'note', cls: 'tool-card--events',
          title: '事件记录本', desc: '随手随笔与重要项目跟踪',
          meta: (r[4] || projects.length)
            ? r[4] + ' 条笔记 · ' + activeProjects + ' 个进行中'
            : '任务清单、预算与进度管理',
          href: '#/events'
        },
        {
          key: 'inventory', icon: 'box', cls: 'tool-card--inventory',
          title: '生活用品库存', desc: '囤货、保质期与补货提醒',
          meta: stock.length
            ? stock.length + ' 项库存' +
              (expiring ? ' · ' + expiring + ' 项临期' : '') +
              (restock ? ' · ' + restock + ' 项待补' : '')
            : '临期自动提示，消耗可登记',
          href: '#/inventory'
        },
        {
          key: 'wardrobe', icon: 'shirt', cls: 'tool-card--wardrobe',
          title: '电子衣柜', desc: '衣物素材、想买清单与搭配创作',
          meta: r[0] + ' 件衣物 · ' + r[1] + ' 条想买 · ' + r[2] + ' 套搭配',
          href: '#/wardrobe'
        }
      ];

      host.innerHTML =
        '<header class="page-head">' +
          '<p class="eyebrow">Personal Workspace</p>' +
          '<h1 class="greeting">' + UI.esc(greeting()) + '</h1>' +
          '<p class="greeting-sub">' + UI.fmtDate(UI.dateStr()) + ' · 数据都在这台设备上</p>' +
        '</header>' +
        '<div data-notices></div>' +
        '<div class="section-label"><span>Tools</span></div>' +
        '<div class="tool-list">' + cards.map(cardHtml).join('') + '</div>' +
        '<div class="section-label"><span>More</span></div>' +
        '<button type="button" class="row-card" data-settings style="cursor:pointer">' +
          '<div class="tool-glyph" style="background:var(--surface-2)">' + UI.icon('data', 20) + '</div>' +
          '<div class="row-body"><p class="item-name">数据与存储</p>' +
          '<p class="item-sub">备份导出、恢复导入、清理数据</p></div>' +
          '<div class="tool-arrow">' + UI.icon('chevron', 16) + '</div>' +
        '</button>' +
        '<p class="page-foot">所有数据仅保存在本机，不会云端上传<br>' +
          '添加到手机桌面后，断网也能继续使用</p>';

      UI.on(host, '.tool-card[data-href]', 'click', function (e) {
        location.hash = e.currentTarget.dataset.href;
      });
      UI.on(host, '.tool-card[aria-disabled="true"]', 'click', function () {
        UI.toast('这个模块还在开发中');
      });
      host.querySelector('[data-settings]').addEventListener('click', function () {
        location.hash = '#/settings';
      });

      renderNotices();
    });
  }

  /** 首页提醒条：存储紧张与备份过期 */
  function renderNotices() {
    var box = host.querySelector('[data-notices]');
    if (!box) return;

    global.Health.notices().then(function (list) {
      box.innerHTML = global.Health.noticeHtml(list);
      if (!list.length) return;

      UI.on(box, '[data-go]', 'click', function () {
        location.hash = '#/settings';
      });

      UI.on(box, '[data-dismiss]', 'click', function (e) {
        var card = e.currentTarget.closest('[data-notice]');
        global.Health.dismissToday().then(function () {
          if (card) card.remove();
          UI.toast('今天不再提醒');
        });
      });
    });
  }

  function cardHtml(c) {
    var attrs = c.soon
      ? ' aria-disabled="true"'
      : ' data-href="' + UI.esc(c.href) + '"';
    return '<button type="button" class="tool-card ' + c.cls + '"' + attrs + '>' +
      '<div class="tool-glyph">' + UI.icon(c.icon, 22) + '</div>' +
      '<div class="tool-body">' +
        '<p class="tool-title">' + UI.esc(c.title) + '</p>' +
        '<p class="tool-desc">' + UI.esc(c.desc) + '</p>' +
        '<p class="tool-meta">' + UI.esc(c.meta) + (c.soon ? ' · 即将上线' : '') + '</p>' +
      '</div>' +
      '<div class="tool-arrow">' + UI.icon('chevron', 16) + '</div>' +
    '</button>';
  }

  /* ---------------- 电子衣柜外壳 ---------------- */

  function renderWardrobe() {
    var W = global.Wardrobe;
    var tab = W.state.tab;

    host.innerHTML =
      '<div class="topbar">' +
        '<button type="button" class="icon-btn" data-back aria-label="返回首页">' +
          UI.icon('back', 18) + '</button>' +
        '<div class="topbar-title"><h1>电子衣柜</h1>' +
          '<p>衣物、想买清单与搭配创作</p></div>' +
      '</div>' +
      '<div class="segmented" role="tablist">' + TABS.map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t.key +
          '" aria-selected="' + (tab === t.key) + '">' + t.label + '</button>';
      }).join('') + '</div>' +
      '<div data-panel></div>' +
      '<p class="page-foot">图片经过压缩后保存在本机，不会上传任何服务器</p>';

    host.querySelector('[data-back]').addEventListener('click', function () {
      location.hash = '#/';
    });

    UI.on(host, '[data-tab]', 'click', function (e) {
      var key = e.currentTarget.dataset.tab;
      if (key === W.state.tab) return;
      W.state.tab = key;
      location.hash = '#/wardrobe/' + key;
    });

    var panel = host.querySelector('[data-panel]');
    var fab = null;

    function mountFab(label, handler) {
      if (fab) fab.remove();
      fab = UI.el('<button type="button" class="fab">' + UI.icon('plus', 18) +
        UI.esc(label) + '</button>');
      fab.addEventListener('click', handler);
      document.body.appendChild(fab);
    }

    clearFab();

    if (tab === 'closet') {
      W.closet.render(panel).then(function () {
        mountFab('添加衣物', function () {
          W.closet.openForm(null, function () { W.closet.render(panel); });
        });
      });
    } else if (tab === 'wishlist') {
      W.wishlist.render(panel).then(function () {
        mountFab('添加单品', function () {
          W.wishlist.openForm(null, function () { W.wishlist.render(panel); });
        });
      });
    } else if (tab === 'avatars') {
      W.avatars.render(panel).then(function () {
        mountFab('上传人物', function () {
          W.avatars.openForm(function () { W.avatars.render(panel); });
        });
      });
    } else {
      W.outfits.render(panel);
    }
  }

  function clearFab() {
    document.querySelectorAll('.fab').forEach(function (el) { el.remove(); });
  }

  /** 统一的模块外壳：返回按钮 + 标题 + 内容容器 + 悬浮新增 */
  function moduleShell(config) {
    var c = config;
    host.innerHTML =
      '<div class="topbar">' +
        '<button type="button" class="icon-btn" data-back aria-label="返回首页">' +
          UI.icon('back', 18) + '</button>' +
        '<div class="topbar-title"><h1>' + UI.esc(c.title) + '</h1>' +
          '<p>' + UI.esc(c.subtitle) + '</p></div>' +
      '</div>' +
      '<div data-panel></div>' +
      '<p class="page-foot">' + UI.esc(c.foot || '数据只保存在本机') + '</p>';

    host.querySelector('[data-back]').addEventListener('click', function () {
      location.hash = '#/';
    });
    clearFab();
    return host.querySelector('[data-panel]');
  }

  function mountFab(label, handler) {
    clearFab();
    var fab = UI.el('<button type="button" class="fab">' + UI.icon('plus', 18) +
      UI.esc(label) + '</button>');
    fab.addEventListener('click', handler);
    document.body.appendChild(fab);
    return fab;
  }

  /* ---------------- 电子物品档案 ---------------- */

  function renderDevices() {
    var panel = moduleShell({
      title: '电子物品档案',
      subtitle: '设备、配件与保修管理',
      foot: '使用天数与保修剩余每次打开都会重新计算'
    });
    global.Devices.render(panel).then(function () {
      mountFab('添加设备', function () {
        global.Devices.openForm(null, function () {
          global.Devices.render(panel);
        });
      });
    });
  }

  /* ---------------- 事件记录本 ---------------- */

  function renderEvents() {
    var panel = moduleShell({
      title: '事件记录本',
      subtitle: '随手一记与重大事件跟踪',
      foot: '笔记、附件与项目资料都只保存在本机'
    });
    global.Events.render(panel).then(function () {
      refreshEventsFab(panel);
    });
  }

  /** 搭配画布编辑器；key 为 'new' 或已有方案 id */
  function renderOutfitEditor(key) {
    global.Wardrobe.state.tab = 'outfits';

    if (key === 'new') {
      global.Wardrobe.outfits.openEditor(null);
      return Promise.resolve();
    }

    host.innerHTML = '<div class="loading">加载搭配方案...</div>';
    return global.Store.get(S.outfits, key).then(function (row) {
      if (!row) {
        UI.toast('这个搭配已不存在', 'warn');
        location.hash = '#/wardrobe/outfits';
        return;
      }
      global.Wardrobe.outfits.openEditor(row);
    }).catch(function () {
      location.hash = '#/wardrobe/outfits';
    });
  }

  /** 项目详情整页渲染；记录不存在时退回列表 */
  function renderProjectDetail(id) {
    host.innerHTML = '<div class="loading">加载项目...</div>';
    global.Events.state.mode = 'projects';

    return global.Store.get(S.projects, id).then(function (p) {
      if (!p) {
        UI.toast('这个项目已不存在', 'warn');
        location.hash = '#/events/projects';
        return;
      }
      global.Events.openProject(p);
    }).catch(function () {
      location.hash = '#/events/projects';
    });
  }

  function refreshEventsFab(panel) {
    var box = panel || host.querySelector('[data-panel]');
    if (!box) return;
    if (global.Events.state.mode === 'notes') {
      mountFab('写一条', function () {
        global.Events.openNoteForm(null, function () { renderEvents(); });
      });
    } else {
      mountFab('新建项目', function () {
        global.Events.openProjectForm(null, function () { renderEvents(); });
      });
    }
  }

  /* ---------------- 生活用品库存 ---------------- */

  function renderInventory() {
    var panel = moduleShell({
      title: '生活用品库存',
      subtitle: '囤货、保质期与补货',
      foot: '保质期倒计时每次打开都会重新计算'
    });
    global.Inventory.render(panel).then(function () {
      mountFab('添加商品', function () {
        global.Inventory.openForm(null, function () {
          global.Inventory.render(panel);
        });
      });
    });
  }

  /* ---------------- 主题 ---------------- */

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function setDark(on) {
    var root = document.documentElement;
    if (on) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', on ? '#23211E' : '#EFEAE3');
    try { localStorage.setItem('wb_theme', on ? 'dark' : 'light'); } catch (e) { /* 忽略 */ }
    UI.toast(on ? '已切换到深色' : '已切换到奶油浅色');
  }

  /* ---------------- 数据与存储 ---------------- */

  var PURGE_GROUPS = [
    {
      key: 'wardrobe', label: '清空电子衣柜',
      desc: '衣物、想买清单、人物素材与搭配方案',
      stores: [S.clothes, S.wishlist, S.avatars, S.outfits]
    },
    {
      key: 'devices', label: '清空电子物品档案',
      desc: '设备记录与实拍照片',
      stores: [S.devices]
    },
    {
      key: 'events', label: '清空事件记录本',
      desc: '随手笔记、重大事件、任务与附件',
      stores: [S.notes, S.projects]
    },
    {
      key: 'inventory', label: '清空生活用品库存',
      desc: '商品与消耗记录',
      stores: [S.inventory]
    }
  ];

  function renderSettings() {
    host.innerHTML =
      '<div class="topbar">' +
        '<button type="button" class="icon-btn" data-back aria-label="返回">' +
          UI.icon('back', 18) + '</button>' +
        '<div class="topbar-title"><h1>数据与存储</h1><p>全部保存在本机浏览器</p></div>' +
      '</div>' +

      '<div class="section-label"><span>备份</span></div>' +
      '<div class="panel">' +
        '<div data-backup-state></div>' +
        '<p style="margin:0 0 12px;font-size:12.5px;color:var(--ink-2);line-height:1.7">' +
          '导出会打包成一个 ZIP，里面含全部记录和原始照片。换手机或清理浏览器数据' +
          '之前先导一份，之后可以完整恢复。</p>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn btn--primary" data-export>' +
            UI.icon('save', 16) + '导出备份</button>' +
          '<button type="button" class="btn btn--soft" data-import>' +
            UI.icon('up', 16) + '导入恢复</button>' +
        '</div>' +
        '<div class="io-progress" data-io hidden></div>' +
        '<div class="field" style="margin-top:16px">' +
          '<label>备份提醒</label>' +
          '<div class="option-row" data-chips="reminder"></div>' +
          '<p class="field-hint">超过设定天数没有导出时，首页会出现提醒。</p>' +
        '</div>' +
      '</div>' +

      '<div class="section-label"><span>外观</span></div>' +
      '<label class="switch-row">' +
        '<span><b>深色模式</b><i>默认使用奶油浅色，夜间可切换</i></span>' +
        '<input type="checkbox" data-theme-toggle' +
          (isDark() ? ' checked' : '') + ' role="switch"></label>' +

      '<div class="section-label"><span>存储</span></div>' +
      '<div data-usage class="loading">读取存储占用...</div>' +

      '<div class="section-label"><span>清理</span></div>' +
      '<div class="row-list">' +
        PURGE_GROUPS.map(function (g) {
          return '<button type="button" class="row-card" data-purge="' + g.key + '">' +
            '<div class="row-body"><p class="item-name">' + UI.esc(g.label) + '</p>' +
            '<p class="item-sub">' + UI.esc(g.desc) + '</p></div>' +
            '<div class="tool-arrow">' + UI.icon('trash', 16) + '</div>' +
          '</button>';
        }).join('') +
      '</div>' +
      '<p class="page-foot">清理操作不可恢复。清理浏览器数据也会删除这些内容，' +
        '重要内容请先导出备份。</p>';

    host.querySelector('[data-back]').addEventListener('click', function () {
      location.hash = '#/';
    });

    refreshUsage();
    refreshBackupState();

    host.querySelector('[data-theme-toggle]').addEventListener('change', function (e) {
      setDark(e.currentTarget.checked);
    });

    host.querySelector('[data-export]').addEventListener('click', doExport);
    host.querySelector('[data-import]').addEventListener('click', doImport);

    PURGE_GROUPS.forEach(function (g) {
      host.querySelector('[data-purge="' + g.key + '"]').addEventListener('click', function () {
        UI.confirm({
          title: g.label,
          message: g.desc + ' 将全部删除，包含对应图片与附件。',
          detail: '此操作不可恢复，建议先导出备份。',
          confirmText: '全部清空',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          global.Img.releaseAll();
          Promise.all(g.stores.map(function (name) {
            return global.Store.purgeStore(name);
          })).then(function () {
            UI.toast('已清空');
            refreshUsage();
            refreshBackupState();
          });
        });
      });
    });
  }

  /* ---------------- 备份导出 ---------------- */

  function ioStatus(text) {
    var box = host.querySelector('[data-io]');
    if (!box) return;
    if (!text) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = text;
  }

  function doExport() {
    var btn = host.querySelector('[data-export]');
    btn.disabled = true;
    ioStatus('正在准备备份...');

    global.Backup.exportAll(function (done, total, label) {
      ioStatus(label + ' ' + done + '/' + total);
    }).then(function (res) {
      var name = global.Backup.fileName();
      global.Backup.download(res.blob, name);
      var counts = res.manifest.counts || {};
      var n = Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0);
      ioStatus('已导出 ' + name + '（' + n + ' 条记录、' +
        res.manifest.blobCount + ' 个图片附件、' + UI.bytes(res.blob.size) + '）');
      UI.toast('备份已导出');
      // 记录备份时间点，首页提醒随之复位
      return global.Health.markBackup().then(function () {
        refreshBackupState();
        refreshUsage();
      });
    }).catch(function (err) {
      ioStatus('');
      UI.toast(err.message || '导出失败', 'err');
    }).then(function () {
      btn.disabled = false;
    });
  }

  /* ---------------- 备份导入 ---------------- */

  function doImport() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.remove();
      if (!file) return;

      ioStatus('正在校验备份文件...');
      global.Backup.inspect(file).then(function (info) {
        ioStatus('');
        confirmImport(info);
      }).catch(function (err) {
        ioStatus('');
        UI.toast(err.message || '备份文件无法读取', 'err');
      });
    });

    input.click();
  }

  function confirmImport(info) {
    var rows = info.summary.map(function (s) {
      return '<div><span>' + UI.esc(s.label) + '</span><b>' + s.count + ' 条</b></div>';
    }).join('');

    var when = info.manifest.exportedAt
      ? new Date(info.manifest.exportedAt).toLocaleString('zh-CN')
      : '未知时间';

    var html =
      '<p style="margin:0;font-size:13px;color:var(--ink-2);line-height:1.7">' +
        '备份导出于 ' + UI.esc(when) + '</p>' +
      '<div class="io-summary">' + (rows || '<div><span>没有业务记录</span></div>') +
        '<div><span>图片与附件</span><b>' + info.images + ' 个</b></div>' +
      '</div>' +
      (info.missing.length
        ? '<p class="field-error" style="margin-top:10px">有 ' + info.missing.length +
          ' 个图片文件在备份包里缺失，对应记录会保留但没有图片。</p>'
        : '') +
      '<div class="field" style="margin-top:16px">' +
        '<label>导入方式</label>' +
        '<div class="option-row" data-chips="mode">' +
          '<button type="button" class="chip" data-v="merge" aria-pressed="true">合并到现有数据</button>' +
          '<button type="button" class="chip" data-v="replace" aria-pressed="false">替换全部数据</button>' +
        '</div>' +
        '<p class="field-hint" data-mode-hint>' +
          '合并：相同记录会被备份里的版本覆盖，其余记录保留。</p>' +
      '</div>';

    var mode = 'merge';

    var handle = UI.sheet({
      title: '确认导入',
      content: html,
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '开始导入', className: 'btn--primary',
          onClick: function (body, close) {
            var btn = body.parentElement.querySelector('[data-action="1"]');
            if (btn) { btn.disabled = true; btn.textContent = '导入中...'; }
            global.Img.releaseAll();
            global.Backup.restore(info.payload, mode).then(function (written) {
              close();
              UI.toast('已恢复 ' + written.records + ' 条记录');
              renderSettings();
              ioStatus('导入完成：' + written.records + ' 条记录、' +
                written.blobs + ' 个图片附件');
            }).catch(function (err) {
              if (btn) { btn.disabled = false; btn.textContent = '开始导入'; }
              UI.toast(err.message || '导入失败，数据未改动', 'err');
            });
          }
        }
      ]
    });

    var body = handle.body;
    UI.on(body, '[data-chips="mode"] .chip', 'click', function (e) {
      mode = e.currentTarget.dataset.v;
      body.querySelectorAll('[data-chips="mode"] .chip').forEach(function (c) {
        c.setAttribute('aria-pressed', String(c.dataset.v === mode));
      });
      body.querySelector('[data-mode-hint]').textContent = mode === 'replace'
        ? '替换：先清空本机所有记录与图片，再写入备份内容。'
        : '合并：相同记录会被备份里的版本覆盖，其余记录保留。';
    });
  }

  /** 存储用量：带分级标签、进度条与处置建议 */
  function refreshUsage() {
    var box = host.querySelector('[data-usage]');
    if (!box) return;

    global.Health.storage().then(function (st) {
      box.className = 'usage';

      if (!st.supported) {
        box.innerHTML = '<div class="usage-head"><span>存储用量</span>' +
          '<span class="usage-tag" data-level="ok">无法读取</span></div>' +
          '<p class="usage-hint">' + UI.esc(st.hint) + '</p>';
        return;
      }

      box.innerHTML =
        '<div class="usage-head">' +
          '<span>本机已用 <b>' + UI.bytes(st.usage) + '</b></span>' +
          '<span class="usage-tag" data-level="' + st.level + '">' +
            UI.esc(st.label) + ' ' + st.pct.toFixed(0) + '%</span>' +
        '</div>' +
        '<div class="usage-bar"><i data-level="' + st.level + '" style="width:' +
          Math.max(2, st.pct).toFixed(1) + '%"></i></div>' +
        '<div>配额约 ' + UI.bytes(st.quota) + ' · 剩余 ' + UI.bytes(st.quota - st.usage) +
          ' · 图片附件 ' + st.images + ' 个</div>' +
        '<p class="usage-hint">' + UI.esc(st.hint) + '</p>';
    });
  }

  /** 备份状态：上次时间、距今天数、提醒周期 */
  function refreshBackupState() {
    var box = host.querySelector('[data-backup-state]');
    if (!box) return;

    global.Health.backup().then(function (bk) {
      var when = bk.lastAt
        ? new Date(bk.lastAt).toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
          })
        : '从未导出';

      var extra = bk.total
        ? '共 ' + bk.total + ' 条记录' + (bk.added > 0 ? '，其中 ' + bk.added + ' 条尚未备份' : '')
        : '暂无数据';

      box.innerHTML = '<div class="backup-state">' +
        '<span class="dot" data-level="' + bk.level + '"></span>' +
        '<div><b>' + UI.esc(bk.text) + '</b>' +
          '<span>' + UI.esc(when) + ' · ' + UI.esc(extra) + '</span></div>' +
      '</div>';

      // 提醒周期选项
      var chips = host.querySelector('[data-chips="reminder"]');
      if (chips) {
        chips.innerHTML = global.Health.REMINDER_OPTIONS.map(function (o) {
          return '<button type="button" class="chip" data-v="' + o.key + '" ' +
            'aria-pressed="' + (bk.reminderDays === o.key) + '">' +
            UI.esc(o.label) + '</button>';
        }).join('');
        UI.on(chips, '.chip', 'click', function (e) {
          var v = Number(e.currentTarget.dataset.v);
          global.Health.setReminderDays(v).then(function () {
            UI.toast(v ? '已设为每 ' + v + ' 天提醒' : '已关闭备份提醒');
            refreshBackupState();
          });
        });
      }
    });
  }

  /* ---------------- 路由 ---------------- */

  function route() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean);

    UI.closeSheet(true);
    clearFab();
    releaseImageGroups();
    global.scrollTo(0, 0);

    if (!parts.length) return renderHome();

    if (parts[0] === 'wardrobe') {
      var sub = parts[1];
      var valid = TABS.map(function (t) { return t.key; });
      if (sub && valid.indexOf(sub) !== -1) global.Wardrobe.state.tab = sub;
      // 画布编辑器有独立 hash，便于用返回键退回列表
      if (sub === 'outfits' && parts[2]) {
        return renderOutfitEditor(decodeURIComponent(parts[2]));
      }
      return renderWardrobe();
    }

    if (parts[0] === 'devices') return renderDevices();
    if (parts[0] === 'events') {
      if (parts[1] === 'notes' || parts[1] === 'projects') {
        global.Events.state.mode = parts[1];
      }
      // 项目详情有独立 hash，便于用返回键退回列表
      if (parts[1] === 'projects' && parts[2]) {
        return renderProjectDetail(decodeURIComponent(parts[2]));
      }
      return renderEvents();
    }
    if (parts[0] === 'inventory') return renderInventory();

    if (parts[0] === 'settings') return renderSettings();

    location.hash = '#/';
  }

  function boot() {
    host = document.getElementById('app');

    global.Store.open().then(function () {
      global.addEventListener('hashchange', route);
      route();
      registerServiceWorker();
    }).catch(function (err) {
      host.innerHTML = '<div class="empty"><h3>无法打开本地数据库</h3>' +
        '<p>' + UI.esc(err.message || '请检查浏览器隐私设置是否禁用了本地存储') + '</p></div>';
    });

    // 页面隐藏时回收图片 URL，降低后台内存占用
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') releaseImageGroups();
    });
  }

  /** 切页或后台时回收各模块产生的 ObjectURL */
  function releaseImageGroups() {
    ['wardrobe', 'outfit', 'devices', 'events', 'common'].forEach(function (g) {
      global.Img.releaseGroup(g);
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return; // 本地直接打开时跳过注册

    navigator.serviceWorker.register('service-worker.js').then(function (reg) {
      // 新版本就绪后让它立刻接管，并自动刷新一次，避免用户拿到旧样式
      function promote(worker) {
        if (!worker) return;
        worker.postMessage('skip-waiting');
      }
      if (reg.waiting) promote(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', function () {
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            promote(next);
          }
        });
      });
      reg.update().catch(function () { /* 离线时忽略 */ });
    }).catch(function () {
      /* 离线能力不可用时不影响主流程 */
    });

    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }

  global.App = {
    boot: boot,
    route: route,
    renderHome: renderHome,
    renderWardrobe: renderWardrobe,
    renderDevices: renderDevices,
    renderEvents: renderEvents,
    renderInventory: renderInventory,
    renderSettings: renderSettings,
    refreshEventsFab: refreshEventsFab
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
