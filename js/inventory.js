/* ============================================================
   inventory.js · 生活用品库存
   ------------------------------------------------------------
   保质期倒计时实时计算；消耗记录内嵌在商品文档里，
   单个商品的流水条数有限，内嵌可保证一次事务写入的一致性。
   ============================================================ */
(function (global) {
  'use strict';

  var UI = global.UI;
  var C = global.Common;
  var S = global.Store.S;
  var CAT_KEY = 'inventoryCategories';

  var PRESETS = ['日化用品', '食品饮料', '清洁用品', '纸品', '药品', '宠物用品', '其他'];
  var UNITS = ['个', '瓶', '包', '盒', '袋', '卷', '片', '支', 'ml', 'g'];

  var state = { keyword: '', category: '全部', view: 'all' };

  var VIEWS = [
    { key: 'all', label: '全部' },
    { key: 'expiring', label: '临期' },
    { key: 'restock', label: '待补货' }
  ];

  var cats = PRESETS.slice();

  function list() {
    return global.Store.getAll(S.inventory);
  }

  /* ---------------- 派生计算 ---------------- */

  /** 保质期分级：<0 已过期，<=7 重点，<=30 轻提醒 */
  function shelf(row) {
    if (!row.expiryDate) return { text: '未设保质期', cls: '', level: 3 };
    var n = C.Days.until(row.expiryDate);
    if (n < 0) return { text: '已过期 ' + Math.abs(n) + ' 天', cls: 'badge--risk', level: 0 };
    if (n === 0) return { text: '今天到期', cls: 'badge--risk', level: 0 };
    if (n <= 7) return { text: '剩 ' + n + ' 天', cls: 'badge--risk', level: 0 };
    if (n <= 30) return { text: '剩 ' + n + ' 天', cls: 'badge--warn', level: 1 };
    return { text: '剩 ' + n + ' 天', cls: 'badge--ok', level: 2 };
  }

  function needRestock(row) {
    var th = Number(row.threshold);
    if (!th) return false;
    return Number(row.qty || 0) <= th;
  }

  function isExpiring(row) {
    return shelf(row).level <= 1;
  }

  /* ---------------- 列表 ---------------- */

  function render(host) {
    host.innerHTML = '<div class="loading">加载库存...</div>';

    return C.Cats.load(CAT_KEY, PRESETS).then(function (loaded) {
      cats = loaded;
      return list();
    }).then(function (rows) {
      var visible = rows.filter(function (r) {
        if (state.category !== '全部' && r.category !== state.category) return false;
        if (state.view === 'expiring' && !isExpiring(r)) return false;
        if (state.view === 'restock' && !needRestock(r)) return false;
        return C.List.match(r, state.keyword, ['name', 'category', 'place', 'note']);
      });

      // 临期优先，其次数量少的
      visible.sort(function (a, b) {
        var la = shelf(a).level, lb = shelf(b).level;
        if (la !== lb) return la - lb;
        var ra = needRestock(a) ? 0 : 1, rb = needRestock(b) ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

      var html = C.List.toolbar(state, cats, { placeholder: '搜索商品、存放位置' });

      html += '<div class="chip-row" data-view style="margin:-4px 0 16px">' +
        VIEWS.map(function (v) {
          var n = v.key === 'all' ? rows.length
            : v.key === 'expiring' ? rows.filter(isExpiring).length
            : rows.filter(needRestock).length;
          return '<button type="button" class="chip" data-v="' + v.key + '" ' +
            'aria-pressed="' + (state.view === v.key) + '">' + v.label + ' ' + n + '</button>';
        }).join('') +
        '<button type="button" class="chip" data-manage-cats>' +
          UI.icon('grid', 12) + ' 管理分类</button>' +
      '</div>';

      if (!rows.length) {
        html += C.List.empty('box', '库存还是空的',
          '登记日化囤货和食品储备，临近过期会自动提醒。', '添加商品');
      } else if (!visible.length) {
        html += C.List.noMatch();
      } else {
        html += '<div class="row-list">' + visible.map(cardHtml).join('') + '</div>';
      }

      host.innerHTML = html;
      bind(host, rows);
      return rows.length;
    });
  }

  function cardHtml(row) {
    var sh = shelf(row);
    var bits = ['<span class="badge">' + UI.esc(row.category || '未分类') + '</span>'];
    bits.push('<span class="badge ' + sh.cls + '">' + UI.esc(sh.text) + '</span>');
    if (needRestock(row)) bits.push('<span class="badge badge--warn">该补货了</span>');

    return '<div class="row-card" data-id="' + UI.esc(row.id) + '">' +
      '<div class="row-body" data-open>' +
        '<p class="item-name">' + UI.esc(row.name || '未命名') + '</p>' +
        '<p class="item-sub">' + bits.join(' ') + '</p>' +
        (row.place ? '<p class="task-meta">放在 ' + UI.esc(row.place) + '</p>' : '') +
      '</div>' +
      '<div class="stepper" data-stepper>' +
        '<button type="button" data-minus aria-label="减少">−</button>' +
        '<span>' + UI.esc(String(row.qty || 0)) + UI.esc(row.unit || '') + '</span>' +
        '<button type="button" data-plus aria-label="增加">+</button>' +
      '</div>' +
    '</div>';
  }

  function bind(host, rows) {
    var rerender = function () { render(host); };
    C.List.bindToolbar(host, state, rerender);

    UI.on(host, '[data-view] .chip[data-v]', 'click', function (e) {
      state.view = e.currentTarget.dataset.v;
      rerender();
    });

    var mc = host.querySelector('[data-manage-cats]');
    if (mc) mc.addEventListener('click', function () { manageCats(rerender); });

    var reset = host.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', function () {
      state.keyword = ''; state.category = '全部'; state.view = 'all'; rerender();
    });

    var add = host.querySelector('[data-add]');
    if (add) add.addEventListener('click', function () { openForm(null, rerender); });

    function find(id) { return rows.filter(function (r) { return r.id === id; })[0]; }

    UI.on(host, '[data-open]', 'click', function (e) {
      openDetail(find(e.currentTarget.closest('.row-card').dataset.id), rerender);
    });

    // 步进器改数量前重新读库：列表渲染后数据可能在详情页或别处被改过，
    // 直接用渲染时的快照会把最新数量覆盖掉。
    UI.on(host, '[data-plus]', 'click', function (e) {
      e.stopPropagation();
      var id = e.currentTarget.closest('.row-card').dataset.id;
      global.Store.get(S.inventory, id).then(function (row) {
        if (!row) return;
        row.qty = Number(row.qty || 0) + 1;
        row.updatedAt = Date.now();
        return global.Store.put(S.inventory, row);
      }).then(rerender);
    });

    UI.on(host, '[data-minus]', 'click', function (e) {
      e.stopPropagation();
      var id = e.currentTarget.closest('.row-card').dataset.id;
      global.Store.get(S.inventory, id).then(function (row) {
        if (!row) return null;
        if (Number(row.qty || 0) <= 0) {
          UI.toast('已经没有库存了', 'warn');
          return null;
        }
        return consume(row, 1).then(function () {
          if (Number(row.qty) <= Number(row.threshold || 0)) {
            UI.toast('库存偏低，记得补货');
          }
        });
      }).then(rerender);
    });
  }

  /** 记一笔消耗并扣减库存 */
  function consume(row, qty, note) {
    var n = Number(qty) || 0;
    if (n <= 0) return Promise.resolve();
    row.qty = Math.max(0, Number(row.qty || 0) - n);
    row.consumes = (row.consumes || []).concat([{
      id: global.Store.uid('cs'),
      qty: n,
      date: UI.dateStr(),
      note: note || '',
      createdAt: Date.now()
    }]);
    row.updatedAt = Date.now();
    return global.Store.put(S.inventory, row);
  }

  function manageCats(onDone) {
    C.Cats.manage({
      key: CAT_KEY,
      presets: PRESETS,
      title: '管理库存分类',
      fallback: '其他',
      usage: function (name) {
        return list().then(function (rows) {
          return rows.filter(function (r) { return r.category === name; }).length;
        });
      },
      onDelete: function (name) {
        return list().then(function (rows) {
          return Promise.all(rows.filter(function (r) { return r.category === name; })
            .map(function (r) {
              r.category = '其他';
              r.updatedAt = Date.now();
              return global.Store.put(S.inventory, r);
            }));
        });
      },
      onRename: function (from, to) {
        return list().then(function (rows) {
          return Promise.all(rows.filter(function (r) { return r.category === from; })
            .map(function (r) {
              r.category = to;
              r.updatedAt = Date.now();
              return global.Store.put(S.inventory, r);
            }));
        });
      },
      onDone: function () { if (onDone) onDone(); }
    });
  }

  /* ---------------- 详情 ---------------- */

  function openDetail(row, onChange) {
    if (!row) return;

    function body() {
      var sh = shelf(row);
      var logs = (row.consumes || []).slice().reverse();
      var info = [
        ['分类', row.category],
        ['当前数量', (row.qty || 0) + (row.unit || '')],
        ['购入日期', row.buyDate ? UI.fmtDate(row.buyDate) : ''],
        ['保质期至', row.expiryDate ? UI.fmtDate(row.expiryDate) + '（' + sh.text + '）' : ''],
        ['单价', row.price ? UI.money(row.price) : ''],
        ['存放位置', row.place],
        ['补货阈值', row.threshold ? row.threshold + (row.unit || '') : ''],
        ['备注', row.note]
      ].filter(function (r) { return r[1]; });

      var html = '<dl class="detail-list">' + info.map(function (r) {
        return '<div><dt>' + UI.esc(r[0]) + '</dt><dd>' + UI.esc(r[1]) + '</dd></div>';
      }).join('') + '</dl>';

      html += '<div class="panel" style="margin-top:16px">' +
        '<div class="panel-head"><h3>消耗记录</h3>' +
          '<button type="button" class="btn btn--soft btn--sm" data-add-consume>登记消耗</button>' +
        '</div>';
      if (!logs.length) {
        html += '<p class="panel-empty">还没有消耗记录</p>';
      } else {
        html += logs.slice(0, 20).map(function (l) {
          return '<div class="money-row"><span>' + UI.fmtDate(l.date) +
            (l.note ? ' <span class="sub">' + UI.esc(l.note) + '</span>' : '') +
            '</span><b>-' + UI.esc(String(l.qty)) + UI.esc(row.unit || '') + '</b></div>';
        }).join('');
        if (logs.length > 20) {
          html += '<p class="panel-empty">仅显示最近 20 条，共 ' + logs.length + ' 条</p>';
        }
      }
      html += '</div>';

      html += '<label class="switch-row" style="margin-top:4px">' +
        '<span><b>补货备忘</b><i>标记后会出现在待补货列表</i></span>' +
        '<input type="checkbox" data-restock' + (row.restockFlag ? ' checked' : '') +
        ' role="switch"></label>';

      return html;
    }

    var handle = UI.sheet({
      title: row.name || '商品详情',
      content: body(),
      actions: [
        {
          label: '删除', className: 'btn--danger',
          onClick: function (b, close) {
            UI.confirm({
              title: '删除商品',
              message: '「' + (row.name || '未命名') + '」及其消耗记录会被删除。',
              confirmText: '删除', danger: true
            }).then(function (ok) {
              if (!ok) return;
              global.Store.del(S.inventory, row.id).then(function () {
                UI.toast('已删除');
                close();
                if (onChange) onChange();
              });
            });
          }
        },
        {
          label: '编辑', className: 'btn--primary',
          onClick: function (b, close) { close(); openForm(row, onChange); }
        }
      ]
    });

    function rebind() {
      var host = handle.body;
      host.querySelector('[data-add-consume]').addEventListener('click', function () {
        openConsume(row, function () {
          host.innerHTML = body();
          rebind();
          if (onChange) onChange();
        });
      });
      host.querySelector('[data-restock]').addEventListener('change', function (e) {
        row.restockFlag = e.currentTarget.checked;
        row.updatedAt = Date.now();
        global.Store.put(S.inventory, row).then(function () {
          UI.toast(row.restockFlag ? '已加入补货备忘' : '已取消补货备忘');
          if (onChange) onChange();
        });
      });
    }
    rebind();
  }

  function openConsume(row, onDone) {
    var draft = { qty: '1', note: '' };
    var handle = UI.sheet({
      title: '登记消耗',
      content: '<div class="form">' +
        '<p class="field-hint">当前库存 ' + (row.qty || 0) + (row.unit || '') + '</p>' +
        C.Fld.number('cs-qty', '消耗数量', draft.qty, {
          name: 'qty', step: '1', min: 0
        }) +
        C.Fld.text('cs-note', '备注', draft.note, {
          name: 'note', placeholder: '可留空', max: 40
        }) +
      '</div>',
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '确认', className: 'btn--primary',
          onClick: function (b, close) {
            var n = Number(draft.qty);
            if (!n || n <= 0) { C.Fld.error(b, 'qty', '请输入大于 0 的数量'); return; }
            if (n > Number(row.qty || 0)) {
              C.Fld.error(b, 'qty', '不能超过当前库存 ' + (row.qty || 0));
              return;
            }
            consume(row, n, draft.note).then(function () {
              UI.toast('已登记消耗');
              close();
              if (onDone) onDone();
            });
          }
        }
      ]
    });
    C.Fld.bind(handle.body, draft, {});
  }

  /* ---------------- 表单 ---------------- */

  function openForm(row, onDone) {
    var editing = !!row;
    var draft = {
      id: editing ? row.id : global.Store.uid('inv'),
      name: editing ? (row.name || '') : '',
      category: editing ? (row.category || cats[0]) : cats[0],
      qty: editing ? (row.qty || 0) : 1,
      unit: editing ? (row.unit || UNITS[0]) : UNITS[0],
      buyDate: editing ? (row.buyDate || '') : UI.dateStr(),
      expiryDate: editing ? (row.expiryDate || '') : '',
      price: editing ? (row.price || '') : '',
      place: editing ? (row.place || '') : '',
      threshold: editing ? (row.threshold || '') : '',
      note: editing ? (row.note || '') : '',
      consumes: editing ? (row.consumes || []) : [],
      restockFlag: editing ? !!row.restockFlag : false,
      createdAt: editing ? row.createdAt : Date.now()
    };

    var Fld = C.Fld;
    var html = '<div class="form">' +
      Fld.text('i-name', '商品名称', draft.name, {
        name: 'name', placeholder: '例如 抽纸 3层', max: 40
      }) +
      Fld.chips('cat', '分类', cats, draft.category, { manageLabel: '管理分类' }) +
      '<div class="field-2col">' +
        Fld.number('i-qty', '数量', draft.qty, { name: 'qty', step: '1' }) +
        Fld.chips('unit', '单位', UNITS, draft.unit) +
      '</div>' +
      '<div class="field-2col">' +
        Fld.date('i-buy', '购入日期', draft.buyDate, { name: 'buyDate' }) +
        Fld.date('i-exp', '保质期至', draft.expiryDate, { name: 'expiryDate' }) +
      '</div>' +
      '<div data-derived class="io-summary"></div>' +
      '<div class="field-2col">' +
        Fld.number('i-price', '单价', draft.price, { name: 'price' }) +
        Fld.number('i-th', '补货阈值', draft.threshold, {
          name: 'threshold', step: '1', hint: '低于该数量时提醒补货'
        }) +
      '</div>' +
      Fld.text('i-place', '存放位置', draft.place, {
        name: 'place', placeholder: '例如 阳台储物柜', max: 30
      }) +
      Fld.area('i-note', '备注', draft.note, { name: 'note', max: 300 }) +
    '</div>';

    var handle = UI.sheet({
      title: editing ? '编辑商品' : '添加商品',
      content: html,
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '保存', className: 'btn--primary',
          onClick: function (body, close) {
            if (!draft.name.trim()) { Fld.error(body, 'name', '请填写商品名称'); return; }
            var q = Number(draft.qty);
            if (isNaN(q) || q < 0) { Fld.error(body, 'qty', '数量不能为负'); return; }
            draft.name = draft.name.trim();
            draft.qty = q;
            draft.updatedAt = Date.now();
            global.Store.put(S.inventory, draft).then(function () {
              UI.toast(editing ? '已更新' : '已添加');
              close();
              if (onDone) onDone();
            });
          }
        }
      ]
    });

    var body = handle.body;
    Fld.bind(body, draft, { cat: 'category', unit: 'unit' });

    function refreshDerived() {
      var box = body.querySelector('[data-derived]');
      if (!draft.expiryDate) { box.hidden = true; return; }
      var sh = shelf(draft);
      box.hidden = false;
      box.innerHTML = '<div><span>保质期</span><b>' + UI.esc(sh.text) + '</b></div>';
    }
    var exp = body.querySelector('[data-f="expiryDate"]');
    if (exp) exp.addEventListener('input', refreshDerived);
    refreshDerived();

    var manageBtn = body.querySelector('[data-manage="cat"]');
    if (manageBtn) manageBtn.addEventListener('click', function () {
      manageCats(function () {
        C.Cats.load(CAT_KEY, PRESETS).then(function (loaded) {
          cats = loaded;
          if (cats.indexOf(draft.category) === -1) draft.category = cats[0] || '';
          body.querySelector('[data-chips="cat"]').innerHTML = cats.map(function (c) {
            return '<button type="button" class="chip" data-v="' + UI.esc(c) + '" ' +
              'aria-pressed="' + (draft.category === c) + '">' + UI.esc(c) + '</button>';
          }).join('');
          Fld.bind(body, draft, { cat: 'category', unit: 'unit' });
        });
      });
    });
  }

  global.Inventory = {
    state: state,
    PRESETS: PRESETS,
    CAT_KEY: CAT_KEY,
    render: render,
    openForm: openForm,
    shelf: shelf,
    needRestock: needRestock,
    isExpiring: isExpiring,
    consume: consume,
    list: list
  };
})(window);
