/* ============================================================
   devices.js · 电子物品档案
   ------------------------------------------------------------
   使用天数、保修剩余、预计更换提醒全部在每次渲染时实时计算，
   数据库只存原始日期，不落地任何派生结果。
   ============================================================ */
(function (global) {
  'use strict';

  var UI = global.UI;
  var C = global.Common;
  var S = global.Store.S;
  var GROUP = 'devices';
  var CAT_KEY = 'deviceCategories';

  var PRESETS = ['手机', '平板', '笔记本电脑', '耳机', '相机', '显示器',
    '手柄', '存储设备', '充电器/线材', '其他数码配件'];

  var state = { keyword: '', category: '全部', sort: 'created' };

  var SORTS = [
    { key: 'created', label: '最近添加' },
    { key: 'used', label: '使用最久' },
    { key: 'price', label: '价格' },
    { key: 'warranty', label: '保修到期' }
  ];

  var cats = PRESETS.slice();

  function list() {
    return global.Store.getAll(S.devices).then(function (rows) {
      return rows;
    });
  }

  /* ---------------- 派生计算 ---------------- */

  function warranty(row) {
    if (!row.warrantyDate) return { text: '未设保修', cls: '' };
    var n = C.Days.until(row.warrantyDate);
    if (n < 0) return { text: '已过保', cls: 'badge--risk' };
    if (n === 0) return { text: '保修今天到期', cls: 'badge--risk' };
    if (n <= 30) return { text: '保修剩 ' + n + ' 天', cls: 'badge--warn' };
    return { text: '保修剩 ' + n + ' 天', cls: 'badge--ok' };
  }

  function replacement(row) {
    if (!row.buyDate || !row.replaceYears) return null;
    var target = C.Days.addYears(row.buyDate, row.replaceYears);
    var n = C.Days.until(target);
    if (n === null) return null;
    if (n < 0) return { text: '建议检查是否更换', cls: 'badge--risk', date: target };
    if (n <= 30) return { text: '预计 ' + n + ' 天后更换', cls: 'badge--warn', date: target };
    if (n <= 90) return { text: '更换期临近', cls: 'badge--warn', date: target };
    return { text: '更换期 ' + UI.fmtDate(target), cls: '', date: target };
  }

  function usedDays(row) {
    var n = C.Days.since(row.buyDate);
    return n === null || n < 0 ? null : n;
  }

  /* ---------------- 列表 ---------------- */

  function render(host) {
    host.innerHTML = '<div class="loading">加载设备档案...</div>';

    return C.Cats.load(CAT_KEY, PRESETS).then(function (loaded) {
      cats = loaded;
      return list();
    }).then(function (rows) {
      var visible = rows.filter(function (r) {
        if (state.category !== '全部' && r.category !== state.category) return false;
        return C.List.match(r, state.keyword, ['name', 'brand', 'category', 'specs', 'note']);
      });

      visible.sort(function (a, b) {
        if (state.sort === 'used') {
          return (C.Days.since(a.buyDate) === null ? -1 : C.Days.since(a.buyDate)) <
                 (C.Days.since(b.buyDate) === null ? -1 : C.Days.since(b.buyDate)) ? 1 : -1;
        }
        if (state.sort === 'price') return (Number(b.price) || 0) - (Number(a.price) || 0);
        if (state.sort === 'warranty') {
          var an = C.Days.until(a.warrantyDate);
          var bn = C.Days.until(b.warrantyDate);
          if (an === null) return 1;
          if (bn === null) return -1;
          return an - bn;
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

      var html = C.List.toolbar(state, cats, { placeholder: '搜索设备名称、品牌、参数' });

      html += '<div class="chip-row" data-sort style="margin:-4px 0 16px">' +
        SORTS.map(function (s) {
          return '<button type="button" class="chip" data-v="' + s.key + '" ' +
            'aria-pressed="' + (state.sort === s.key) + '">' + s.label + '</button>';
        }).join('') +
        '<button type="button" class="chip" data-manage-cats>' +
          UI.icon('grid', 12) + ' 管理分类</button>' +
      '</div>';

      if (!rows.length) {
        html += C.List.empty('device', '还没有设备档案',
          '把手机、耳机、相机登记进来，自动帮你算使用天数和保修剩余。', '添加设备');
      } else if (!visible.length) {
        html += C.List.noMatch();
      } else {
        html += summaryHtml(rows);
        html += '<div class="row-list">' + visible.map(cardHtml).join('') + '</div>';
      }

      host.innerHTML = html;
      UI.bindLazyImages(host);
      bind(host, rows);
      return rows.length;
    });
  }

  function summaryHtml(rows) {
    var total = rows.reduce(function (n, r) { return n + (Number(r.price) || 0); }, 0);
    var expiring = rows.filter(function (r) {
      var n = C.Days.until(r.warrantyDate);
      return n !== null && n >= 0 && n <= 30;
    }).length;
    var expired = rows.filter(function (r) {
      var n = C.Days.until(r.warrantyDate);
      return n !== null && n < 0;
    }).length;

    return '<div class="stat-row">' +
      '<div class="stat"><b>' + rows.length + '</b><span>台设备</span></div>' +
      '<div class="stat"><b>' + (total ? UI.money(total).replace('¥', '') : '—') + '</b><span>累计投入</span></div>' +
      '<div class="stat"><b>' + expiring + '</b><span>保修将到期</span></div>' +
      '<div class="stat"><b>' + expired + '</b><span>已过保</span></div>' +
    '</div>';
  }

  function cardHtml(row) {
    var w = warranty(row);
    var rep = replacement(row);
    var used = usedDays(row);
    var cover = (row.photos && row.photos[0]) || null;

    var bits = [];
    bits.push('<span class="badge">' + UI.esc(row.category || '未分类') + '</span>');
    if (used !== null) bits.push('<span class="badge badge--soft">已用 ' + used + ' 天</span>');
    bits.push('<span class="badge ' + w.cls + '">' + UI.esc(w.text) + '</span>');
    if (rep && rep.cls) bits.push('<span class="badge ' + rep.cls + '">' + UI.esc(rep.text) + '</span>');

    return '<div class="row-card" data-id="' + UI.esc(row.id) + '">' +
      '<div class="row-thumb">' +
        (cover
          ? '<img data-blob="' + UI.esc(cover.thumbId || cover.fullId) + '" data-group="' + GROUP +
            '" alt="" loading="lazy" decoding="async">'
          : '<div class="thumb-empty" style="display:grid;place-items:center;height:100%;color:var(--ink-faint)">' +
            UI.icon('device', 18) + '</div>') +
      '</div>' +
      '<div class="row-body" data-open>' +
        '<p class="item-name">' + UI.esc(row.name || '未命名设备') + '</p>' +
        '<p class="item-sub">' + bits.join(' ') + '</p>' +
        (row.brand ? '<p class="task-meta">' + UI.esc(row.brand) + '</p>' : '') +
      '</div>' +
      '<div class="row-actions">' +
        '<button type="button" class="corner-btn" data-edit aria-label="编辑">' + UI.icon('edit', 14) + '</button>' +
        '<button type="button" class="corner-btn" data-del aria-label="删除">' + UI.icon('trash', 14) + '</button>' +
      '</div>' +
    '</div>';
  }

  function bind(host, rows) {
    var rerender = function () { render(host); };
    C.List.bindToolbar(host, state, rerender);

    UI.on(host, '[data-sort] .chip[data-v]', 'click', function (e) {
      state.sort = e.currentTarget.dataset.v;
      rerender();
    });

    var mc = host.querySelector('[data-manage-cats]');
    if (mc) mc.addEventListener('click', function () { manageCats(rerender); });

    var reset = host.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', function () {
      state.keyword = ''; state.category = '全部'; rerender();
    });

    var add = host.querySelector('[data-add]');
    if (add) add.addEventListener('click', function () { openForm(null, rerender); });

    function find(id) { return rows.filter(function (r) { return r.id === id; })[0]; }

    UI.on(host, '[data-open]', 'click', function (e) {
      openDetail(find(e.currentTarget.closest('.row-card').dataset.id), rerender);
    });
    UI.on(host, '[data-edit]', 'click', function (e) {
      openForm(find(e.currentTarget.closest('.row-card').dataset.id), rerender);
    });
    UI.on(host, '[data-del]', 'click', function (e) {
      var row = find(e.currentTarget.closest('.row-card').dataset.id);
      if (!row) return;
      UI.confirm({
        title: '删除设备档案',
        message: '「' + (row.name || '未命名设备') + '」及其照片会被删除。',
        detail: '此操作不可恢复。',
        confirmText: '删除', danger: true
      }).then(function (ok) {
        if (!ok) return;
        global.Store.removeRecord(S.devices, row).then(function () {
          UI.toast('已删除');
          rerender();
        });
      });
    });
  }

  function manageCats(onDone) {
    C.Cats.manage({
      key: CAT_KEY,
      presets: PRESETS,
      title: '管理设备分类',
      fallback: '其他数码配件',
      usage: function (name) {
        return list().then(function (rows) {
          return rows.filter(function (r) { return r.category === name; }).length;
        });
      },
      onDelete: function (name) {
        return list().then(function (rows) {
          var hits = rows.filter(function (r) { return r.category === name; });
          return Promise.all(hits.map(function (r) {
            r.category = '其他数码配件';
            r.updatedAt = Date.now();
            return global.Store.put(S.devices, r);
          }));
        });
      },
      onRename: function (from, to) {
        return list().then(function (rows) {
          var hits = rows.filter(function (r) { return r.category === from; });
          return Promise.all(hits.map(function (r) {
            r.category = to;
            r.updatedAt = Date.now();
            return global.Store.put(S.devices, r);
          }));
        });
      },
      onDone: function () { if (onDone) onDone(); }
    });
  }

  /* ---------------- 详情 ---------------- */

  function openDetail(row, onChange) {
    if (!row) return;
    var w = warranty(row);
    var rep = replacement(row);
    var used = usedDays(row);

    var info = [
      ['分类', row.category],
      ['品牌型号', row.brand],
      ['购入渠道', row.channel],
      ['购入日期', row.buyDate ? UI.fmtDate(row.buyDate) : ''],
      ['购入价格', row.price ? UI.money(row.price) : ''],
      ['已使用', used !== null ? used + ' 天' : ''],
      ['保修到期', row.warrantyDate ? UI.fmtDate(row.warrantyDate) + '（' + w.text + '）' : ''],
      ['预计更换', rep ? UI.fmtDate(rep.date) + '（' + rep.text + '）' : ''],
      ['硬件参数', row.specs],
      ['维修历史', row.repairs],
      ['备注', row.note]
    ].filter(function (r) { return r[1]; });

    var photos = (row.photos || []);
    var html = '';
    if (photos.length) {
      html += '<div class="photo-grid" style="margin-bottom:16px">' +
        photos.map(function (p, i) {
          return '<div class="photo-cell" data-vi="' + i + '">' +
            '<img data-blob="' + UI.esc(p.thumbId || p.fullId) + '" data-group="' + GROUP +
            '" alt="照片" loading="lazy" decoding="async"></div>';
        }).join('') + '</div>';
    }
    html += '<dl class="detail-list">' + info.map(function (r) {
      return '<div><dt>' + UI.esc(r[0]) + '</dt><dd>' + UI.esc(r[1]) + '</dd></div>';
    }).join('') + '</dl>';

    var handle = UI.sheet({
      title: row.name || '设备详情',
      content: html,
      actions: [
        { label: '关闭', className: 'btn--ghost' },
        {
          label: '编辑', className: 'btn--primary',
          onClick: function (b, close) { close(); openForm(row, onChange); }
        }
      ]
    });

    UI.bindLazyImages(handle.body);
    UI.on(handle.body, '.photo-cell img', 'click', function (e) {
      var i = Number(e.currentTarget.closest('[data-vi]').dataset.vi);
      var p = photos[i];
      if (!p) return;
      global.Img.url(p.fullId, GROUP).then(function (url) { if (url) UI.viewer(url); });
    });
  }

  /* ---------------- 表单 ---------------- */

  function openForm(row, onDone) {
    var editing = !!row;
    var draft = {
      id: editing ? row.id : global.Store.uid('dev'),
      name: editing ? (row.name || '') : '',
      category: editing ? (row.category || cats[0]) : cats[0],
      brand: editing ? (row.brand || '') : '',
      channel: editing ? (row.channel || '') : '',
      buyDate: editing ? (row.buyDate || '') : '',
      price: editing ? (row.price || '') : '',
      warrantyDate: editing ? (row.warrantyDate || '') : '',
      replaceYears: editing ? (row.replaceYears || '') : '',
      specs: editing ? (row.specs || '') : '',
      repairs: editing ? (row.repairs || '') : '',
      note: editing ? (row.note || '') : '',
      photos: editing ? (row.photos || []).slice() : [],
      createdAt: editing ? row.createdAt : Date.now()
    };
    var stale = [];

    var Fld = C.Fld;
    var html = '<div class="form">' +
      C.Photos.html('实拍照片', draft.photos, {
        addLabel: '添加照片',
        hint: '可以多张，例如正面、背面、配件与发票'
      }) +
      Fld.text('d-name', '设备名称', draft.name, {
        name: 'name', placeholder: '例如 iPhone 15 Pro', max: 40
      }) +
      Fld.chips('cat', '分类', cats, draft.category, { manageLabel: '管理分类' }) +
      Fld.text('d-brand', '品牌型号', draft.brand, {
        name: 'brand', placeholder: '例如 Apple A3102', max: 40
      }) +
      '<div class="field-2col">' +
        Fld.text('d-channel', '购入渠道', draft.channel, {
          name: 'channel', placeholder: '京东自营', max: 30
        }) +
        Fld.number('d-price', '购入价格', draft.price, { name: 'price' }) +
      '</div>' +
      '<div class="field-2col">' +
        Fld.date('d-buy', '购入日期', draft.buyDate, { name: 'buyDate' }) +
        Fld.date('d-warranty', '保修到期', draft.warrantyDate, { name: 'warrantyDate' }) +
      '</div>' +
      Fld.number('d-replace', '预计更换年限', draft.replaceYears, {
        name: 'replaceYears', step: '0.5', placeholder: '例如 3',
        hint: '填写后会按购入日期推算更换时间并提前提醒'
      }) +
      '<div data-derived class="io-summary"></div>' +
      Fld.area('d-specs', '硬件基础参数', draft.specs, {
        name: 'specs', placeholder: '容量、内存、颜色、序列号等，自由填写', max: 600
      }) +
      Fld.area('d-repairs', '维修历史', draft.repairs, {
        name: 'repairs', placeholder: '换过电池、屏幕维修记录', max: 600
      }) +
      Fld.area('d-note', '备注', draft.note, { name: 'note', max: 300 }) +
    '</div>';

    var handle = UI.sheet({
      title: editing ? '编辑设备' : '添加设备',
      content: html,
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '保存', className: 'btn--primary',
          onClick: function (body, close) {
            if (!draft.name.trim()) {
              Fld.error(body, 'name', '请填写设备名称');
              return;
            }
            draft.name = draft.name.trim();
            draft.updatedAt = Date.now();
            global.Store.put(S.devices, draft).then(function () {
              return stale.length ? global.Store.delBlobs(stale) : null;
            }).then(function () {
              UI.toast(editing ? '已更新' : '已添加');
              close();
              if (onDone) onDone();
            }).catch(function (e) {
              UI.toast(e.message || '保存失败', 'err');
            });
          }
        }
      ]
    });

    var body = handle.body;
    Fld.bind(body, draft, { cat: 'category' });
    C.Photos.bind(body, draft, 'photos', stale, '设备照片');

    // 实时预览派生结果，让用户当场看到算得对不对
    function refreshDerived() {
      var box = body.querySelector('[data-derived]');
      var lines = [];
      var used = C.Days.since(draft.buyDate);
      if (used !== null && used >= 0) {
        lines.push(['已使用', used + ' 天']);
      }
      if (draft.warrantyDate) {
        lines.push(['保修', warranty(draft).text]);
      }
      if (draft.buyDate && draft.replaceYears) {
        var t = C.Days.addYears(draft.buyDate, draft.replaceYears);
        lines.push(['预计更换', UI.fmtDate(t)]);
      }
      if (!lines.length) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      box.innerHTML = lines.map(function (l) {
        return '<div><span>' + UI.esc(l[0]) + '</span><b>' + UI.esc(l[1]) + '</b></div>';
      }).join('');
    }

    ['buyDate', 'warrantyDate', 'replaceYears'].forEach(function (f) {
      var input = body.querySelector('[data-f="' + f + '"]');
      if (input) input.addEventListener('input', refreshDerived);
    });
    refreshDerived();

    var manageBtn = body.querySelector('[data-manage="cat"]');
    if (manageBtn) manageBtn.addEventListener('click', function () {
      manageCats(function () {
        C.Cats.load(CAT_KEY, PRESETS).then(function (loaded) {
          cats = loaded;
          var box = body.querySelector('[data-chips="cat"]');
          if (draft.category && cats.indexOf(draft.category) === -1) {
            draft.category = cats[0] || '';
          }
          box.innerHTML = cats.map(function (c) {
            return '<button type="button" class="chip" data-v="' + UI.esc(c) + '" ' +
              'aria-pressed="' + (draft.category === c) + '">' + UI.esc(c) + '</button>';
          }).join('');
          Fld.bind(body, draft, { cat: 'category' });
        });
      });
    });
  }

  global.Devices = {
    state: state,
    PRESETS: PRESETS,
    CAT_KEY: CAT_KEY,
    render: render,
    openForm: openForm,
    warranty: warranty,
    replacement: replacement,
    usedDays: usedDays,
    list: list
  };
})(window);
