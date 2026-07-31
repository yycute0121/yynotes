/* ============================================================
   wardrobe.js · 电子衣柜
   ------------------------------------------------------------
   子模块：我的衣橱 / 想买清单 / 数字人物 / 搭配画布
   数据与图片全部保存在本机 IndexedDB，不做任何上传。
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store.S;

  var CATEGORIES = ['上衣', '下装', '连衣裙', '外套', '鞋子', '包包', '配饰', '家居服', '其他'];
  var SEASONS = ['春', '夏', '秋', '冬', '四季'];
  var WISH_STATUS = [
    { key: 'want', label: '想买' },
    { key: 'hesitate', label: '犹豫' },
    { key: 'bought', label: '已购入' }
  ];

  var MAX_STAGE_NODES = 14; // 画布素材上限，控制同时驻留的解码图数量

  var state = {
    tab: 'closet',
    keyword: '',
    category: '全部',
    season: '全部',
    wishFilter: 'all',
    outfitId: null
  };

  function statusLabel(key) {
    var hit = WISH_STATUS.filter(function (s) { return s.key === key; })[0];
    return hit ? hit.label : '想买';
  }

  function statusClass(key) {
    if (key === 'bought') return 'badge--ok';
    if (key === 'hesitate') return 'badge--warn';
    return 'badge--soft';
  }

  /* ============================================================
     图片导入：选图 → 压缩 → 可选本地抠图 → 落库
     ============================================================ */

  /**
   * 打开图片处理抽屉。回调 onDone({fullId, thumbId, w, h})
   * 处理链路：File → decode → 压缩预览 → 抠图（可选）→ persist
   */
  function openImagePicker(options, onDone) {
    var opts = options || {};
    var working = {
      source: null,   // ImageBitmap 或 HTMLImageElement
      canvas: null,   // 当前预览用 canvas
      previewUrl: '',
      cut: false,
      tolerance: 30
    };

    var html =
      '<div class="picker">' +
        '<div class="picker-drop" data-drop>' +
          global.UI.icon('image', 26) +
          '<div><b style="display:block;color:var(--ink-2);font-size:13px">选择图片</b>' +
          '相机拍照、相册选择或粘贴保存的电商图</div>' +
          '<input type="file" accept="image/*" data-file>' +
        '</div>' +
        '<div data-stage hidden>' +
          '<div class="picker-preview"><img data-preview alt="图片预览"></div>' +
          '<label class="chip" style="margin-top:12px;display:inline-flex;gap:8px;align-items:center">' +
            '<input type="checkbox" data-cut style="accent-color:var(--accent-ink)"> 自动去除背景' +
          '</label>' +
          '<div class="range-field" data-tol-wrap hidden style="margin-top:12px">' +
            '<div class="range-head"><span>去背强度</span><b data-tol-val>30</b></div>' +
            '<input type="range" min="8" max="70" value="30" data-tol>' +
            '<p class="field-hint">纯色底或白底效果最好。全部在本机计算，不上传图片。</p>' +
          '</div>' +
        '</div>' +
        '<p class="field-hint" data-tip>图片会自动压缩到长边 ' + global.Img.FULL_MAX +
          'px 再保存，另生成缩略图用于列表。</p>' +
      '</div>';

    var handle = global.UI.sheet({
      title: opts.title || '添加图片',
      content: html,
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '保存', className: 'btn--primary',
          onClick: function (body, close) {
            if (!working.canvas) { global.UI.toast('请先选择一张图片', 'warn'); return; }
            var btn = body.parentElement.querySelector('[data-action="1"]');
            if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
            global.Img.persist(working.canvas, { alpha: working.cut })
              .then(function (res) {
                cleanup();
                close();
                onDone(res);
              })
              .catch(function (err) {
                if (btn) { btn.disabled = false; btn.textContent = '保存'; }
                global.UI.toast(err.message || '图片保存失败', 'err');
              });
          }
        }
      ],
      onClose: cleanup
    });

    var body = handle.body;
    var fileInput = body.querySelector('[data-file]');
    var stage = body.querySelector('[data-stage]');
    var previewImg = body.querySelector('[data-preview]');
    var cutBox = body.querySelector('[data-cut]');
    var tolWrap = body.querySelector('[data-tol-wrap]');
    var tolInput = body.querySelector('[data-tol]');
    var tolVal = body.querySelector('[data-tol-val]');

    function cleanup() {
      if (working.previewUrl) { URL.revokeObjectURL(working.previewUrl); working.previewUrl = ''; }
      global.Img.disposeCanvas(working.canvas);
      global.Img.release(working.source);
      working.canvas = null;
      working.source = null;
    }

    function renderPreview() {
      if (!working.source) return;
      global.Img.disposeCanvas(working.canvas);
      working.canvas = working.cut
        ? global.Img.removeBackground(working.source, working.tolerance)
        : global.Img.drawTo(working.source, 900);

      global.Img.canvasToBlob(working.canvas, 'image/png', 0.9).then(function (blob) {
        if (working.previewUrl) URL.revokeObjectURL(working.previewUrl);
        working.previewUrl = URL.createObjectURL(blob);
        previewImg.src = working.previewUrl;
      });
    }

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      global.UI.toast('正在处理图片...');
      global.Img.decode(file).then(function (source) {
        global.Img.release(working.source);
        working.source = source;
        stage.hidden = false;
        renderPreview();
      }).catch(function (err) {
        global.UI.toast(err.message || '图片读取失败', 'err');
      });
    });

    cutBox.addEventListener('change', function () {
      working.cut = cutBox.checked;
      tolWrap.hidden = !working.cut;
      renderPreview();
    });

    var applyTol = global.UI.debounce(function () { renderPreview(); }, 260);
    tolInput.addEventListener('input', function () {
      working.tolerance = Number(tolInput.value);
      tolVal.textContent = tolInput.value;
      applyTol();
    });
  }

  /* ============================================================
     数据访问
     ============================================================ */

  function listClothes() {
    return global.Store.getAll(S.clothes).then(function (rows) {
      return rows.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    });
  }

  function listWishes() {
    return global.Store.getAll(S.wishlist).then(function (rows) {
      return rows.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    });
  }

  function listAvatars() {
    return global.Store.getAll(S.avatars).then(function (rows) {
      return rows.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    });
  }

  function listOutfits() {
    return global.Store.getAll(S.outfits).then(function (rows) {
      return rows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    });
  }

  function removeWithImages(storeName, row, fields) {
    var ids = [];
    (fields || ['fullId', 'thumbId']).forEach(function (f) { if (row[f]) ids.push(row[f]); });
    return global.Store.delBlobs(ids).then(function () {
      return global.Store.del(storeName, row.id);
    });
  }

  global.Wardrobe = {
    CATEGORIES: CATEGORIES,
    SEASONS: SEASONS,
    WISH_STATUS: WISH_STATUS,
    MAX_STAGE_NODES: MAX_STAGE_NODES,
    state: state,
    statusLabel: statusLabel,
    statusClass: statusClass,
    openImagePicker: openImagePicker,
    listClothes: listClothes,
    listWishes: listWishes,
    listAvatars: listAvatars,
    listOutfits: listOutfits,
    removeWithImages: removeWithImages
  };
})(window);

/* ============================================================
   wardrobe.closet.js · 我的衣橱
   ============================================================ */
(function (global) {
  'use strict';

  var W = global.Wardrobe;
  var UI = global.UI;
  var S = global.Store.S;
  var GROUP = 'wardrobe';

  function matches(item, st) {
    if (st.category !== '全部' && item.category !== st.category) return false;
    if (st.season !== '全部' && item.season !== st.season) return false;
    if (st.keyword) {
      var kw = st.keyword.toLowerCase();
      var hay = [item.name, item.brand, item.color, item.category, item.note]
        .filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(kw) === -1) return false;
    }
    return true;
  }

  function cardHtml(item) {
    var bits = [];
    if (item.category) bits.push('<span class="badge">' + UI.esc(item.category) + '</span>');
    if (item.season) bits.push('<span class="badge">' + UI.esc(item.season) + '</span>');
    if (item.price) bits.push(UI.money(item.price));

    var thumb = item.thumbId
      ? '<img data-blob="' + UI.esc(item.thumbId) + '" data-group="' + GROUP +
        '" alt="' + UI.esc(item.name) + '" loading="lazy" decoding="async">'
      : '<div class="thumb-empty">无图片</div>';

    return '<div class="item-card" data-id="' + UI.esc(item.id) + '">' +
      '<div class="item-thumb" data-open>' + thumb +
        '<div class="item-corner">' +
          '<button type="button" class="corner-btn" data-edit aria-label="编辑">' + UI.icon('edit', 14) + '</button>' +
          '<button type="button" class="corner-btn" data-del aria-label="删除">' + UI.icon('trash', 14) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="item-body">' +
        '<p class="item-name">' + UI.esc(item.name || '未命名') + '</p>' +
        '<p class="item-sub">' + bits.join(' ') + '</p>' +
      '</div>' +
    '</div>';
  }

  function render(host) {
    host.innerHTML = '<div class="loading">加载衣橱...</div>';

    return W.listClothes().then(function (rows) {
      var st = W.state;
      var visible = rows.filter(function (r) { return matches(r, st); });

      var cats = ['全部'].concat(W.CATEGORIES);
      var seasons = ['全部'].concat(W.SEASONS);

      var html =
        '<div class="toolbar">' +
          '<div class="search-box">' + UI.icon('search', 16) +
            '<input type="search" placeholder="搜索名称、品牌、颜色" value="' +
              UI.esc(st.keyword) + '" data-kw aria-label="搜索衣物">' +
            (st.keyword ? '<button type="button" class="clear-btn" data-kw-clear aria-label="清除">✕</button>' : '') +
          '</div>' +
          '<div class="chip-row" data-cat>' + cats.map(function (c) {
            return '<button type="button" class="chip" data-v="' + UI.esc(c) +
              '" aria-pressed="' + (st.category === c) + '">' + UI.esc(c) + '</button>';
          }).join('') + '</div>' +
          '<div class="chip-row" data-season>' + seasons.map(function (c) {
            return '<button type="button" class="chip" data-v="' + UI.esc(c) +
              '" aria-pressed="' + (st.season === c) + '">' + UI.esc(c) + '</button>';
          }).join('') + '</div>' +
        '</div>';

      if (!rows.length) {
        html += '<div class="empty">' +
          '<div class="empty-glyph">' + UI.icon('shirt', 24) + '</div>' +
          '<h3>衣橱还是空的</h3>' +
          '<p>导入第一件衣物，之后就能在搭配画布里自由拼搭。</p>' +
          '<button type="button" class="btn btn--primary" data-add>' + UI.icon('plus', 16) + '添加衣物</button>' +
        '</div>';
      } else if (!visible.length) {
        html += '<div class="empty"><h3>没有匹配的衣物</h3><p>换个关键词或清掉筛选条件试试。</p>' +
          '<button type="button" class="btn btn--soft" data-reset>清除筛选</button></div>';
      } else {
        html += '<p class="field-hint" style="margin:0 0 12px">共 ' + visible.length + ' 件</p>' +
          '<div class="grid">' + visible.map(cardHtml).join('') + '</div>';
      }

      host.innerHTML = html;
      UI.bindLazyImages(host);
      bindEvents(host, rows);
      return rows.length;
    });
  }

  function bindEvents(host, rows) {
    var st = W.state;
    var rerender = function () { render(host); };

    var kw = host.querySelector('[data-kw]');
    if (kw) {
      kw.addEventListener('input', UI.debounce(function () {
        st.keyword = kw.value.trim();
        rerender();
      }, 260));
    }
    var kwClear = host.querySelector('[data-kw-clear]');
    if (kwClear) kwClear.addEventListener('click', function () { st.keyword = ''; rerender(); });

    UI.on(host, '[data-cat] .chip', 'click', function (e) {
      st.category = e.currentTarget.dataset.v; rerender();
    });
    UI.on(host, '[data-season] .chip', 'click', function (e) {
      st.season = e.currentTarget.dataset.v; rerender();
    });

    var reset = host.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', function () {
      st.keyword = ''; st.category = '全部'; st.season = '全部'; rerender();
    });

    var add = host.querySelector('[data-add]');
    if (add) add.addEventListener('click', function () { openForm(null, rerender); });

    function findRow(id) {
      return rows.filter(function (r) { return r.id === id; })[0];
    }

    UI.on(host, '.item-card [data-edit]', 'click', function (e) {
      e.stopPropagation();
      var id = e.currentTarget.closest('.item-card').dataset.id;
      openForm(findRow(id), rerender);
    });

    UI.on(host, '.item-card [data-del]', 'click', function (e) {
      e.stopPropagation();
      var id = e.currentTarget.closest('.item-card').dataset.id;
      var row = findRow(id);
      if (!row) return;
      UI.confirm({
        title: '删除这件衣物',
        message: '「' + (row.name || '未命名') + '」将被删除，关联图片也会一并清理。',
        detail: '此操作不可恢复。',
        confirmText: '删除',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        W.removeWithImages(S.clothes, row).then(function () {
          UI.toast('已删除');
          rerender();
        });
      });
    });

    UI.on(host, '.item-card [data-open]', 'click', function (e) {
      if (e.target.closest('.corner-btn')) return;
      var id = e.currentTarget.closest('.item-card').dataset.id;
      openDetail(findRow(id), rerender);
    });
  }

  /* ---------------- 详情 ---------------- */

  function openDetail(item, onChange) {
    if (!item) return;
    var rows = [
      ['分类', item.category],
      ['季节', item.season],
      ['颜色', item.color],
      ['品牌', item.brand],
      ['价格', item.price ? UI.money(item.price) : ''],
      ['购买日期', item.buyDate ? UI.fmtDate(item.buyDate) : ''],
      ['备注', item.note]
    ].filter(function (r) { return r[1]; });

    var html = '<div class="picker-preview" style="margin-bottom:16px">' +
      (item.fullId ? '<img data-blob="' + UI.esc(item.fullId) + '" data-group="' + GROUP +
        '" alt="' + UI.esc(item.name) + '">' : '<div class="loading">无图片</div>') +
      '</div>' +
      '<dl class="detail-list">' + rows.map(function (r) {
        return '<div><dt>' + UI.esc(r[0]) + '</dt><dd>' + UI.esc(r[1]) + '</dd></div>';
      }).join('') + '</dl>';

    var handle = UI.sheet({
      title: item.name || '衣物详情',
      content: html,
      actions: [
        { label: '关闭', className: 'btn--ghost' },
        {
          label: '编辑', className: 'btn--primary',
          onClick: function (b, close) { close(); openForm(item, onChange); }
        }
      ]
    });
    UI.bindLazyImages(handle.body);
    var img = handle.body.querySelector('img[data-blob]');
    if (img) img.addEventListener('click', function () { if (img.src) UI.viewer(img.src); });
  }

  /* ---------------- 新增 / 编辑表单 ---------------- */

  function openForm(item, onDone) {
    var editing = !!item;
    var draft = {
      id: editing ? item.id : global.Store.uid('cloth'),
      name: editing ? (item.name || '') : '',
      category: editing ? (item.category || W.CATEGORIES[0]) : W.CATEGORIES[0],
      season: editing ? (item.season || '四季') : '四季',
      color: editing ? (item.color || '') : '',
      brand: editing ? (item.brand || '') : '',
      price: editing ? (item.price || '') : '',
      buyDate: editing ? (item.buyDate || '') : '',
      note: editing ? (item.note || '') : '',
      fullId: editing ? item.fullId : null,
      thumbId: editing ? item.thumbId : null,
      w: editing ? item.w : 0,
      h: editing ? item.h : 0,
      createdAt: editing ? item.createdAt : Date.now()
    };
    var staleBlobs = [];

    var html =
      '<div class="form">' +
        '<div class="field">' +
          '<label>图片</label>' +
          '<div class="picker-preview" data-thumb-wrap>' +
            (draft.fullId
              ? '<img data-blob="' + UI.esc(draft.fullId) + '" data-group="' + GROUP + '" alt="预览">'
              : '<div class="loading">还没有图片</div>') +
          '</div>' +
          '<button type="button" class="btn btn--soft btn--sm" data-pick style="margin-top:8px">' +
            UI.icon('camera', 15) + (draft.fullId ? '更换图片' : '添加图片') + '</button>' +
        '</div>' +
        '<div class="field">' +
          '<label for="w-name">名称</label>' +
          '<input id="w-name" class="input" data-f="name" value="' + UI.esc(draft.name) +
            '" placeholder="例如 米色针织开衫" maxlength="40">' +
          '<p class="field-error" data-err="name" hidden></p>' +
        '</div>' +
        '<div class="field">' +
          '<label>分类</label>' +
          '<div class="option-row" data-cat>' + W.CATEGORIES.map(function (c) {
            return '<button type="button" class="chip" data-v="' + UI.esc(c) +
              '" aria-pressed="' + (draft.category === c) + '">' + UI.esc(c) + '</button>';
          }).join('') + '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label>季节</label>' +
          '<div class="option-row" data-season>' + W.SEASONS.map(function (c) {
            return '<button type="button" class="chip" data-v="' + UI.esc(c) +
              '" aria-pressed="' + (draft.season === c) + '">' + UI.esc(c) + '</button>';
          }).join('') + '</div>' +
        '</div>' +
        '<div class="field-2col">' +
          '<div class="field"><label for="w-color">颜色</label>' +
            '<input id="w-color" class="input" data-f="color" value="' + UI.esc(draft.color) +
              '" placeholder="米白" maxlength="20"></div>' +
          '<div class="field"><label for="w-brand">品牌</label>' +
            '<input id="w-brand" class="input" data-f="brand" value="' + UI.esc(draft.brand) +
              '" placeholder="可留空" maxlength="30"></div>' +
        '</div>' +
        '<div class="field-2col">' +
          '<div class="field"><label for="w-price">价格</label>' +
            '<input id="w-price" class="input" data-f="price" type="number" min="0" step="0.01" ' +
              'inputmode="decimal" value="' + UI.esc(draft.price) + '" placeholder="0"></div>' +
          '<div class="field"><label for="w-date">购买日期</label>' +
            '<input id="w-date" class="input" data-f="buyDate" type="date" value="' +
              UI.esc(draft.buyDate) + '"></div>' +
        '</div>' +
        '<div class="field">' +
          '<label for="w-note">备注</label>' +
          '<textarea id="w-note" class="textarea" data-f="note" maxlength="300" ' +
            'placeholder="尺码、材质、搭配灵感">' + UI.esc(draft.note) + '</textarea>' +
        '</div>' +
      '</div>';

    var handle = UI.sheet({
      title: editing ? '编辑衣物' : '添加衣物',
      content: html,
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '保存', className: 'btn--primary',
          onClick: function (body, close) {
            if (!draft.name.trim()) {
              var err = body.querySelector('[data-err="name"]');
              err.textContent = '请填写衣物名称';
              err.hidden = false;
              return;
            }
            draft.name = draft.name.trim();
            draft.updatedAt = Date.now();
            global.Store.put(S.clothes, draft).then(function () {
              return staleBlobs.length ? global.Store.delBlobs(staleBlobs) : null;
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
    UI.bindLazyImages(body);

    body.querySelectorAll('[data-f]').forEach(function (input) {
      input.addEventListener('input', function () {
        draft[input.dataset.f] = input.value;
        var err = body.querySelector('[data-err="' + input.dataset.f + '"]');
        if (err) err.hidden = true;
      });
    });

    UI.on(body, '[data-cat] .chip', 'click', function (e) {
      draft.category = e.currentTarget.dataset.v;
      body.querySelectorAll('[data-cat] .chip').forEach(function (c) {
        c.setAttribute('aria-pressed', String(c.dataset.v === draft.category));
      });
    });
    UI.on(body, '[data-season] .chip', 'click', function (e) {
      draft.season = e.currentTarget.dataset.v;
      body.querySelectorAll('[data-season] .chip').forEach(function (c) {
        c.setAttribute('aria-pressed', String(c.dataset.v === draft.season));
      });
    });

    body.querySelector('[data-pick]').addEventListener('click', function () {
      W.openImagePicker({ title: '衣物图片' }, function (res) {
        if (draft.fullId) staleBlobs.push(draft.fullId, draft.thumbId);
        draft.fullId = res.fullId;
        draft.thumbId = res.thumbId;
        draft.w = res.w;
        draft.h = res.h;
        var wrap = body.querySelector('[data-thumb-wrap]');
        wrap.innerHTML = '<img data-blob="' + UI.esc(res.fullId) + '" data-group="' + GROUP + '" alt="预览">';
        UI.bindLazyImages(wrap);
        body.querySelector('[data-pick]').innerHTML = UI.icon('camera', 15) + '更换图片';
      });
    });
  }

  W.closet = { render: render, openForm: openForm };
})(window);

/* ============================================================
   wardrobe.wishlist.js · 想买清单
   ============================================================ */
(function (global) {
  'use strict';

  var W = global.Wardrobe;
  var UI = global.UI;
  var S = global.Store.S;
  var GROUP = 'wardrobe';

  function render(host) {
    host.innerHTML = '<div class="loading">加载清单...</div>';

    return W.listWishes().then(function (rows) {
      var st = W.state;
      var visible = st.wishFilter === 'all'
        ? rows
        : rows.filter(function (r) { return r.status === st.wishFilter; });

      var filters = [{ key: 'all', label: '全部' }].concat(W.WISH_STATUS);

      var html = '<div class="chip-row" data-wf style="margin-bottom:16px">' +
        filters.map(function (f) {
          var n = f.key === 'all' ? rows.length
            : rows.filter(function (r) { return r.status === f.key; }).length;
          return '<button type="button" class="chip" data-v="' + f.key +
            '" aria-pressed="' + (st.wishFilter === f.key) + '">' +
            UI.esc(f.label) + ' ' + n + '</button>';
        }).join('') + '</div>';

      if (!rows.length) {
        html += '<div class="empty">' +
          '<div class="empty-glyph">' + UI.icon('heart', 24) + '</div>' +
          '<h3>清单里还没有东西</h3>' +
          '<p>把心动但还没下单的单品存进来，冷静几天再决定。</p>' +
          '<button type="button" class="btn btn--primary" data-add>' +
            UI.icon('plus', 16) + '添加想买单品</button>' +
        '</div>';
      } else if (!visible.length) {
        html += '<div class="empty"><h3>这个状态下暂时没有单品</h3><p>换个筛选看看。</p></div>';
      } else {
        html += '<div class="row-list">' + visible.map(rowHtml).join('') + '</div>';
      }

      host.innerHTML = html;
      UI.bindLazyImages(host);
      bindEvents(host, rows);
      return rows.length;
    });
  }

  function rowHtml(item) {
    var thumb = item.thumbId
      ? '<img data-blob="' + UI.esc(item.thumbId) + '" data-group="' + GROUP +
        '" alt="" loading="lazy" decoding="async">'
      : '';
    var meta = [];
    if (item.category) meta.push(UI.esc(item.category));
    if (item.price) meta.push(UI.money(item.price));

    return '<div class="row-card" data-id="' + UI.esc(item.id) + '">' +
      '<div class="row-thumb">' + thumb + '</div>' +
      '<div class="row-body">' +
        '<p class="item-name">' + UI.esc(item.name || '未命名') + '</p>' +
        '<p class="item-sub">' +
          '<span class="badge ' + W.statusClass(item.status) + '">' +
            UI.esc(W.statusLabel(item.status)) + '</span>' +
          (meta.length ? '<span>' + meta.join(' · ') + '</span>' : '') +
        '</p>' +
      '</div>' +
      '<div class="row-actions">' +
        (item.link ? '<button type="button" class="corner-btn" data-link aria-label="打开链接">' +
          UI.icon('link', 14) + '</button>' : '') +
        '<button type="button" class="corner-btn" data-edit aria-label="编辑">' + UI.icon('edit', 14) + '</button>' +
        '<button type="button" class="corner-btn" data-del aria-label="删除">' + UI.icon('trash', 14) + '</button>' +
      '</div>' +
    '</div>';
  }

  function bindEvents(host, rows) {
    var st = W.state;
    var rerender = function () { render(host); };

    UI.on(host, '.chip-row .chip', 'click', function (e) {
      st.wishFilter = e.currentTarget.dataset.v;
      rerender();
    });

    var add = host.querySelector('[data-add]');
    if (add) add.addEventListener('click', function () { openForm(null, rerender); });

    function findRow(id) { return rows.filter(function (r) { return r.id === id; })[0]; }

    UI.on(host, '[data-edit]', 'click', function (e) {
      openForm(findRow(e.currentTarget.closest('.row-card').dataset.id), rerender);
    });

    UI.on(host, '[data-link]', 'click', function (e) {
      var row = findRow(e.currentTarget.closest('.row-card').dataset.id);
      if (!row || !row.link) return;
      // 仅在用户主动点击时打开，且加 noopener 防止反向控制
      global.open(row.link, '_blank', 'noopener,noreferrer');
    });

    UI.on(host, '[data-del]', 'click', function (e) {
      var row = findRow(e.currentTarget.closest('.row-card').dataset.id);
      if (!row) return;
      UI.confirm({
        title: '删除这条记录',
        message: '「' + (row.name || '未命名') + '」将从想买清单移除。',
        confirmText: '删除',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        W.removeWithImages(S.wishlist, row).then(function () {
          UI.toast('已删除');
          rerender();
        });
      });
    });
  }

  function openForm(item, onDone) {
    var editing = !!item;
    var draft = {
      id: editing ? item.id : global.Store.uid('wish'),
      name: editing ? (item.name || '') : '',
      category: editing ? (item.category || W.CATEGORIES[0]) : W.CATEGORIES[0],
      price: editing ? (item.price || '') : '',
      link: editing ? (item.link || '') : '',
      status: editing ? (item.status || 'want') : 'want',
      note: editing ? (item.note || '') : '',
      fullId: editing ? item.fullId : null,
      thumbId: editing ? item.thumbId : null,
      w: editing ? item.w : 0,
      h: editing ? item.h : 0,
      createdAt: editing ? item.createdAt : Date.now()
    };
    var staleBlobs = [];

    var html =
      '<div class="form">' +
        '<div class="field">' +
          '<label>图片</label>' +
          '<div class="picker-preview" data-thumb-wrap>' +
            (draft.fullId
              ? '<img data-blob="' + UI.esc(draft.fullId) + '" data-group="' + GROUP + '" alt="预览">'
              : '<div class="loading">还没有图片</div>') +
          '</div>' +
          '<button type="button" class="btn btn--soft btn--sm" data-pick style="margin-top:8px">' +
            UI.icon('image', 15) + (draft.fullId ? '更换图片' : '添加图片') + '</button>' +
        '</div>' +
        '<div class="field">' +
          '<label for="k-name">名称</label>' +
          '<input id="k-name" class="input" data-f="name" value="' + UI.esc(draft.name) +
            '" placeholder="例如 羊绒围巾" maxlength="40">' +
          '<p class="field-error" data-err="name" hidden></p>' +
        '</div>' +
        '<div class="field">' +
          '<label>状态</label>' +
          '<div class="option-row" data-status>' + W.WISH_STATUS.map(function (s) {
            return '<button type="button" class="chip" data-v="' + s.key +
              '" aria-pressed="' + (draft.status === s.key) + '">' + UI.esc(s.label) + '</button>';
          }).join('') + '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label>分类</label>' +
          '<div class="option-row" data-cat>' + W.CATEGORIES.map(function (c) {
            return '<button type="button" class="chip" data-v="' + UI.esc(c) +
              '" aria-pressed="' + (draft.category === c) + '">' + UI.esc(c) + '</button>';
          }).join('') + '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label for="k-price">价格</label>' +
          '<input id="k-price" class="input" data-f="price" type="number" min="0" step="0.01" ' +
            'inputmode="decimal" value="' + UI.esc(draft.price) + '" placeholder="0">' +
        '</div>' +
        '<div class="field">' +
          '<label for="k-link">商品链接</label>' +
          '<input id="k-link" class="input" data-f="link" type="url" value="' + UI.esc(draft.link) +
            '" placeholder="粘贴电商链接，可留空" inputmode="url">' +
          '<p class="field-hint">链接只保存在本机，点击时才会打开浏览器。</p>' +
        '</div>' +
        '<div class="field">' +
          '<label for="k-note">备注</label>' +
          '<textarea id="k-note" class="textarea" data-f="note" maxlength="300" ' +
            'placeholder="为什么想买、在等什么价格">' + UI.esc(draft.note) + '</textarea>' +
        '</div>' +
      '</div>';

    var handle = UI.sheet({
      title: editing ? '编辑想买单品' : '添加想买单品',
      content: html,
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '保存', className: 'btn--primary',
          onClick: function (body, close) {
            if (!draft.name.trim()) {
              var err = body.querySelector('[data-err="name"]');
              err.textContent = '请填写单品名称';
              err.hidden = false;
              return;
            }
            draft.name = draft.name.trim();
            draft.updatedAt = Date.now();
            global.Store.put(S.wishlist, draft).then(function () {
              return staleBlobs.length ? global.Store.delBlobs(staleBlobs) : null;
            }).then(function () {
              UI.toast(editing ? '已更新' : '已添加');
              close();
              if (onDone) onDone();
            });
          }
        }
      ]
    });

    var body = handle.body;
    UI.bindLazyImages(body);

    body.querySelectorAll('[data-f]').forEach(function (input) {
      input.addEventListener('input', function () {
        draft[input.dataset.f] = input.value;
        var err = body.querySelector('[data-err="' + input.dataset.f + '"]');
        if (err) err.hidden = true;
      });
    });

    ['status', 'cat'].forEach(function (key) {
      var field = key === 'status' ? 'status' : 'category';
      UI.on(body, '[data-' + key + '] .chip', 'click', function (e) {
        draft[field] = e.currentTarget.dataset.v;
        body.querySelectorAll('[data-' + key + '] .chip').forEach(function (c) {
          c.setAttribute('aria-pressed', String(c.dataset.v === draft[field]));
        });
      });
    });

    body.querySelector('[data-pick]').addEventListener('click', function () {
      W.openImagePicker({ title: '单品图片' }, function (res) {
        if (draft.fullId) staleBlobs.push(draft.fullId, draft.thumbId);
        draft.fullId = res.fullId;
        draft.thumbId = res.thumbId;
        draft.w = res.w;
        draft.h = res.h;
        var wrap = body.querySelector('[data-thumb-wrap]');
        wrap.innerHTML = '<img data-blob="' + UI.esc(res.fullId) + '" data-group="' + GROUP + '" alt="预览">';
        UI.bindLazyImages(wrap);
        body.querySelector('[data-pick]').innerHTML = UI.icon('image', 15) + '更换图片';
      });
    });
  }

  W.wishlist = { render: render, openForm: openForm };
})(window);

/* ============================================================
   wardrobe.avatars.js · 数字人物
   仅作为搭配画布素材，不做 AI 试穿，不做人脸识别，不上传任何图片。
   ============================================================ */
(function (global) {
  'use strict';

  var W = global.Wardrobe;
  var UI = global.UI;
  var S = global.Store.S;
  var GROUP = 'wardrobe';

  function render(host) {
    host.innerHTML = '<div class="loading">加载人物素材...</div>';

    return W.listAvatars().then(function (rows) {
      var html =
        '<div class="usage" style="margin:0 0 16px">' +
          '数字人物只作为搭配画布上的底图素材使用。不做自动试穿，不做人脸识别，' +
          '图片只保存在本机浏览器里。' +
        '</div>';

      if (!rows.length) {
        html += '<div class="empty">' +
          '<div class="empty-glyph">' + UI.icon('person', 24) + '</div>' +
          '<h3>还没有人物素材</h3>' +
          '<p>上传一张全身照，作为搭配时的比例参考。</p>' +
          '<button type="button" class="btn btn--primary" data-add>' +
            UI.icon('plus', 16) + '上传人物' + '</button>' +
        '</div>';
      } else {
        html += '<div class="grid">' + rows.map(function (item) {
          var thumb = item.thumbId
            ? '<img data-blob="' + UI.esc(item.thumbId) + '" data-group="' + GROUP +
              '" alt="' + UI.esc(item.name) + '" loading="lazy" decoding="async">'
            : '<div class="thumb-empty">无图片</div>';
          return '<div class="item-card" data-id="' + UI.esc(item.id) + '">' +
            '<div class="item-thumb">' + thumb +
              '<div class="item-corner">' +
                '<button type="button" class="corner-btn' + (item.isDefault ? ' corner-btn--on' : '') +
                  '" data-default aria-label="设为默认">' + UI.icon('check', 14) + '</button>' +
                '<button type="button" class="corner-btn" data-del aria-label="删除">' +
                  UI.icon('trash', 14) + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="item-body">' +
              '<p class="item-name">' + UI.esc(item.name || '人物素材') + '</p>' +
              '<p class="item-sub">' + (item.isDefault
                ? '<span class="badge badge--ok">默认</span>'
                : '<span class="badge">备选</span>') + '</p>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
      }

      host.innerHTML = html;
      UI.bindLazyImages(host);
      bindEvents(host, rows);
      return rows.length;
    });
  }

  function bindEvents(host, rows) {
    var rerender = function () { render(host); };

    var add = host.querySelector('[data-add]');
    if (add) add.addEventListener('click', function () { openForm(rerender); });

    function findRow(id) { return rows.filter(function (r) { return r.id === id; })[0]; }

    UI.on(host, '[data-default]', 'click', function (e) {
      var id = e.currentTarget.closest('.item-card').dataset.id;
      var tasks = rows.map(function (r) {
        var next = Object.assign({}, r, { isDefault: r.id === id });
        return global.Store.put(S.avatars, next);
      });
      Promise.all(tasks).then(function () {
        UI.toast('已设为默认人物');
        rerender();
      });
    });

    UI.on(host, '[data-del]', 'click', function (e) {
      var row = findRow(e.currentTarget.closest('.item-card').dataset.id);
      if (!row) return;
      UI.confirm({
        title: '删除人物素材',
        message: '删除后已保存的搭配方案里该素材会显示为空白。',
        confirmText: '删除',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        W.removeWithImages(S.avatars, row).then(function () {
          UI.toast('已删除');
          rerender();
        });
      });
    });
  }

  function openForm(onDone) {
    W.openImagePicker({ title: '上传人物素材' }, function (res) {
      var record = {
        id: global.Store.uid('avatar'),
        name: '人物素材',
        fullId: res.fullId,
        thumbId: res.thumbId,
        w: res.w,
        h: res.h,
        isDefault: false,
        createdAt: Date.now()
      };
      W.listAvatars().then(function (rows) {
        record.isDefault = rows.length === 0;
        return global.Store.put(S.avatars, record);
      }).then(function () {
        UI.toast('已添加人物素材');
        if (onDone) onDone();
      });
    });
  }

  W.avatars = { render: render, openForm: openForm };
})(window);

/* ============================================================
   wardrobe.outfits.js · 搭配画布
   ------------------------------------------------------------
   坐标全部以画布比例保存（0-1），换设备、换屏幕尺寸都能等比还原。
   内存策略：画布节点使用 full 图但设上限 MAX_STAGE_NODES；
   节点 URL 归入 outfit 组，退出画布时整组回收。
   ============================================================ */
(function (global) {
  'use strict';

  var W = global.Wardrobe;
  var UI = global.UI;
  var S = global.Store.S;
  var GROUP = 'outfit';

  var editor = null;

  /* ---------------- 列表 ---------------- */

  function render(host) {
    host.innerHTML = '<div class="loading">加载搭配方案...</div>';

    return W.listOutfits().then(function (rows) {
      var html = '';

      if (!rows.length) {
        html += '<div class="empty">' +
          '<div class="empty-glyph">' + UI.icon('layers', 24) + '</div>' +
          '<h3>还没有搭配方案</h3>' +
          '<p>把衣橱里的单品拖到画布上自由拼搭，满意了就存下来。</p>' +
          '<button type="button" class="btn btn--primary" data-new>' +
            UI.icon('plus', 16) + '新建搭配' + '</button>' +
        '</div>';
      } else {
        html += '<button type="button" class="btn btn--soft btn--block" data-new ' +
          'style="margin-bottom:16px">' + UI.icon('plus', 16) + '新建搭配</button>';

        html += '<div class="grid">' + rows.map(function (o) {
          var thumb = o.previewId
            ? '<img data-blob="' + UI.esc(o.previewId) + '" data-group="wardrobe" alt="' +
              UI.esc(o.name) + '" loading="lazy" decoding="async">'
            : '<div class="thumb-empty">无预览</div>';
          return '<div class="item-card" data-id="' + UI.esc(o.id) + '">' +
            '<div class="item-thumb" data-open>' + thumb +
              '<div class="item-corner">' +
                '<button type="button" class="corner-btn" data-del aria-label="删除">' +
                  UI.icon('trash', 14) + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="item-body">' +
              '<p class="item-name">' + UI.esc(o.name || '未命名搭配') + '</p>' +
              '<p class="item-sub"><span>' + (o.nodes ? o.nodes.length : 0) + ' 件素材</span></p>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
      }

      host.innerHTML = html;
      UI.bindLazyImages(host);

      var rerender = function () { render(host); };

      // 画布编辑器整页接管，走路由才能让返回键正常退回列表
      UI.on(host, '[data-new]', 'click', function () {
        location.hash = '#/wardrobe/outfits/new';
      });

      UI.on(host, '[data-open]', 'click', function (e) {
        if (e.target.closest('.corner-btn')) return;
        var id = e.currentTarget.closest('.item-card').dataset.id;
        location.hash = '#/wardrobe/outfits/' + encodeURIComponent(id);
      });

      UI.on(host, '[data-del]', 'click', function (e) {
        e.stopPropagation();
        var id = e.currentTarget.closest('.item-card').dataset.id;
        var row = rows.filter(function (r) { return r.id === id; })[0];
        if (!row) return;
        UI.confirm({
          title: '删除搭配方案',
          message: '「' + (row.name || '未命名搭配') + '」将被删除。衣橱里的原始衣物不受影响。',
          confirmText: '删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          global.Store.delBlobs([row.previewId]).then(function () {
            return global.Store.del(S.outfits, row.id);
          }).then(function () {
            UI.toast('已删除');
            rerender();
          });
        });
      });

      return rows.length;
    });
  }

  /* ---------------- 编辑器 ---------------- */

  var LIST_HASH = '#/wardrobe/outfits';

  /** 返回搭配列表。hash 已在列表时直接重建整页 */
  function backToList() {
    global.Img.releaseGroup(GROUP);
    editor = null;
    if (location.hash === LIST_HASH) global.App.renderWardrobe();
    else location.hash = LIST_HASH;
  }

  function openEditor(outfit) {
    var host = document.getElementById('app');
    var editing = !!outfit;

    editor = {
      id: editing ? outfit.id : global.Store.uid('outfit'),
      name: editing ? (outfit.name || '') : '',
      note: editing ? (outfit.note || '') : '',
      nodes: editing ? (outfit.nodes || []).map(function (n) { return Object.assign({}, n); }) : [],
      previewId: editing ? outfit.previewId : null,
      createdAt: editing ? outfit.createdAt : Date.now(),
      activeId: null
    };

    host.innerHTML =
      '<div class="topbar">' +
        '<button type="button" class="icon-btn" data-back aria-label="返回">' + UI.icon('back', 18) + '</button>' +
        '<div class="topbar-title"><h1>' + (editing ? '编辑搭配' : '新建搭配') + '</h1>' +
          '<p>拖动移动，双指或右下角手柄缩放</p></div>' +
      '</div>' +
      '<div class="canvas-wrap">' +
        '<div class="canvas-stage" data-stage>' +
          '<div class="canvas-hint" data-hint>从下方素材里选择衣物或人物，点一下加入画布</div>' +
        '</div>' +
        '<div class="canvas-toolbar">' +
          '<button type="button" class="btn btn--soft btn--sm" data-up>' + UI.icon('up', 14) + '上移</button>' +
          '<button type="button" class="btn btn--soft btn--sm" data-down>' + UI.icon('down', 14) + '下移</button>' +
          '<button type="button" class="btn btn--soft btn--sm" data-bigger>放大</button>' +
          '<button type="button" class="btn btn--soft btn--sm" data-smaller>缩小</button>' +
          '<button type="button" class="btn btn--danger btn--sm" data-remove>移除</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-clear>清空</button>' +
        '</div>' +
      '</div>' +
      '<div class="section-label">人物素材</div>' +
      '<div class="tray" data-tray-avatar><span class="field-hint">加载中...</span></div>' +
      '<div class="section-label">衣物素材</div>' +
      '<div class="tray" data-tray-cloth><span class="field-hint">加载中...</span></div>' +
      '<div class="btn-row" style="margin-top:20px">' +
        '<button type="button" class="btn btn--ghost" data-cancel>取消</button>' +
        '<button type="button" class="btn btn--primary" data-save>' + UI.icon('save', 16) + '保存搭配</button>' +
      '</div>' +
      '<p class="page-foot">搭配方案与素材图片都只保存在本机</p>';

    var stage = host.querySelector('[data-stage]');
    var hint = host.querySelector('[data-hint]');

    /* ---- 布局 ---- */
    function layout() {
      var sw = stage.clientWidth;
      var sh = stage.clientHeight;
      if (!sw || !sh) return;
      editor.nodes.forEach(function (n) {
        var el = stage.querySelector('[data-node="' + n.id + '"]');
        if (!el) return;
        var w = Math.max(24, n.wr * sw);
        var h = w * (n.ratio || 1.2);
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.style.transform = 'translate3d(' + (n.xr * sw) + 'px,' + (n.yr * sh) + 'px,0)';
        el.style.zIndex = String(n.z || 1);
      });
      hint.hidden = editor.nodes.length > 0;
    }

    var onResize = UI.debounce(layout, 160);
    global.addEventListener('resize', onResize);

    /* ---- 节点渲染 ---- */
    function mountNode(n) {
      var el = UI.el(
        '<div class="stage-node" data-node="' + UI.esc(n.id) + '">' +
          '<img alt="搭配素材">' +
          '<button type="button" class="node-handle" data-handle aria-label="缩放">' +
            UI.icon('resize', 13) + '</button>' +
        '</div>'
      );
      stage.appendChild(el);
      global.Img.url(n.fullId, GROUP).then(function (url) {
        var img = el.querySelector('img');
        if (url && img) img.src = url;
      });
      bindNode(el, n);
      return el;
    }

    function setActive(id) {
      editor.activeId = id;
      stage.querySelectorAll('.stage-node').forEach(function (el) {
        el.classList.toggle('is-active', el.dataset.node === id);
      });
    }

    function bindNode(el, n) {
      var sw = 0, sh = 0;
      var pointers = new Map();
      var mode = null;         // 'move' | 'pinch'
      var start = null;

      function dist(a, b) {
        var dx = a.x - b.x, dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
      }

      el.addEventListener('pointerdown', function (e) {
        if (e.target.closest('[data-handle]')) return;
        e.preventDefault();
        setActive(n.id);
        sw = stage.clientWidth;
        sh = stage.clientHeight;
        el.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 1) {
          mode = 'move';
          start = { x: e.clientX, y: e.clientY, xr: n.xr, yr: n.yr };
        } else if (pointers.size === 2) {
          var pts = Array.from(pointers.values());
          mode = 'pinch';
          start = { d: dist(pts[0], pts[1]) || 1, wr: n.wr, xr: n.xr, yr: n.yr };
        }
      });

      el.addEventListener('pointermove', function (e) {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (mode === 'move' && start) {
          var dx = (e.clientX - start.x) / sw;
          var dy = (e.clientY - start.y) / sh;
          n.xr = clamp(start.xr + dx, -0.4, 1.2);
          n.yr = clamp(start.yr + dy, -0.4, 1.2);
          applyTransform();
        } else if (mode === 'pinch' && pointers.size === 2 && start) {
          var pts = Array.from(pointers.values());
          var ratio = dist(pts[0], pts[1]) / start.d;
          var nextWr = clamp(start.wr * ratio, 0.08, 1.6);
          // 以中心缩放，避免元素跑偏
          var delta = (nextWr - start.wr) / 2;
          n.wr = nextWr;
          n.xr = clamp(start.xr - delta, -0.4, 1.2);
          applyTransform();
        }
      });

      function endPointer(e) {
        pointers.delete(e.pointerId);
        if (pointers.size === 0) { mode = null; start = null; }
        else if (pointers.size === 1) {
          var only = Array.from(pointers.entries())[0];
          mode = 'move';
          start = { x: only[1].x, y: only[1].y, xr: n.xr, yr: n.yr };
        }
      }
      el.addEventListener('pointerup', endPointer);
      el.addEventListener('pointercancel', endPointer);

      function applyTransform() {
        var w = Math.max(24, n.wr * sw);
        var h = w * (n.ratio || 1.2);
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.style.transform = 'translate3d(' + (n.xr * sw) + 'px,' + (n.yr * sh) + 'px,0)';
      }

      // 右下角手柄：单指精确缩放
      var handle = el.querySelector('[data-handle]');
      var hStart = null;
      handle.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setActive(n.id);
        sw = stage.clientWidth;
        sh = stage.clientHeight;
        handle.setPointerCapture(e.pointerId);
        hStart = { x: e.clientX, wr: n.wr };
      });
      handle.addEventListener('pointermove', function (e) {
        if (!hStart) return;
        var dx = (e.clientX - hStart.x) / sw;
        n.wr = clamp(hStart.wr + dx, 0.08, 1.6);
        applyTransform();
      });
      function endHandle() { hStart = null; }
      handle.addEventListener('pointerup', endHandle);
      handle.addEventListener('pointercancel', endHandle);
    }

    stage.addEventListener('pointerdown', function (e) {
      if (e.target === stage || e.target === hint) setActive(null);
    });

    /* ---- 素材托盘 ---- */
    function addNode(source, refType) {
      if (editor.nodes.length >= W.MAX_STAGE_NODES) {
        UI.toast('画布素材已达 ' + W.MAX_STAGE_NODES + ' 件上限', 'warn');
        return;
      }
      if (!source.fullId) { UI.toast('这个素材没有图片', 'warn'); return; }

      var ratio = source.w && source.h ? source.h / source.w : 1.25;
      var isAvatar = refType === 'avatar';
      var maxZ = editor.nodes.reduce(function (m, n) { return Math.max(m, n.z || 1); }, 0);

      var node = {
        id: global.Store.uid('node'),
        refType: refType,
        refId: source.id,
        fullId: source.fullId,
        ratio: ratio,
        wr: isAvatar ? 0.52 : 0.34,
        xr: isAvatar ? 0.24 : 0.33,
        yr: isAvatar ? 0.06 : 0.3,
        z: isAvatar ? 1 : maxZ + 1
      };
      editor.nodes.push(node);
      mountNode(node);
      layout();
      setActive(node.id);
    }

    function fillTray(selector, allRows, refType, emptyText) {
      var tray = host.querySelector(selector);
      // 没有图片的素材无法参与拼搭，直接不进托盘，避免点了没反应
      var rows = allRows.filter(function (r) { return !!r.fullId; });
      if (!rows.length) {
        var noImage = allRows.length > 0;
        tray.innerHTML = '<span class="field-hint">' +
          (noImage ? '已有记录但都还没有图片，补一张图后即可用于搭配' : emptyText) +
          '</span>';
        return;
      }
      tray.innerHTML = rows.map(function (r) {
        return '<button type="button" class="tray-item" data-ref="' + UI.esc(r.id) + '" ' +
          'aria-label="' + UI.esc(r.name || '素材') + '">' +
          (r.thumbId ? '<img data-blob="' + UI.esc(r.thumbId) + '" data-group="wardrobe" ' +
            'alt="" loading="lazy" decoding="async">' : '') + '</button>';
      }).join('');
      UI.bindLazyImages(tray);
      UI.on(tray, '[data-ref]', 'click', function (e) {
        var id = e.currentTarget.dataset.ref;
        var row = rows.filter(function (r) { return r.id === id; })[0];
        if (row) addNode(row, refType);
      });
    }

    W.listAvatars().then(function (rows) {
      fillTray('[data-tray-avatar]', rows, 'avatar', '还没有人物素材，可在「数字人物」里上传');
    });
    W.listClothes().then(function (rows) {
      fillTray('[data-tray-cloth]', rows, 'cloth', '衣橱还是空的，先去添加衣物');
    });

    /* ---- 已有节点回填 ---- */
    editor.nodes.forEach(mountNode);
    requestAnimationFrame(layout);

    /* ---- 工具栏 ---- */
    function activeNode() {
      return editor.nodes.filter(function (n) { return n.id === editor.activeId; })[0];
    }
    function requireActive() {
      var n = activeNode();
      if (!n) UI.toast('先点选一个素材', 'warn');
      return n;
    }

    host.querySelector('[data-up]').addEventListener('click', function () {
      var n = requireActive(); if (!n) return;
      n.z = (n.z || 1) + 1;
      layout();
    });
    host.querySelector('[data-down]').addEventListener('click', function () {
      var n = requireActive(); if (!n) return;
      n.z = Math.max(0, (n.z || 1) - 1);
      layout();
    });
    host.querySelector('[data-bigger]').addEventListener('click', function () {
      var n = requireActive(); if (!n) return;
      n.wr = clamp(n.wr * 1.12, 0.08, 1.6);
      layout();
    });
    host.querySelector('[data-smaller]').addEventListener('click', function () {
      var n = requireActive(); if (!n) return;
      n.wr = clamp(n.wr / 1.12, 0.08, 1.6);
      layout();
    });
    host.querySelector('[data-remove]').addEventListener('click', function () {
      var n = requireActive(); if (!n) return;
      editor.nodes = editor.nodes.filter(function (x) { return x.id !== n.id; });
      var el = stage.querySelector('[data-node="' + n.id + '"]');
      if (el) el.remove();
      setActive(null);
      layout();
    });
    host.querySelector('[data-clear]').addEventListener('click', function () {
      if (!editor.nodes.length) return;
      UI.confirm({
        title: '清空画布',
        message: '画布上的素材会全部移除，衣橱里的衣物不受影响。',
        confirmText: '清空'
      }).then(function (ok) {
        if (!ok) return;
        editor.nodes = [];
        stage.querySelectorAll('.stage-node').forEach(function (el) { el.remove(); });
        setActive(null);
        layout();
      });
    });

    /* ---- 退出与保存 ---- */
    function leave() {
      global.removeEventListener('resize', onResize);
      backToList();
    }

    host.querySelector('[data-back]').addEventListener('click', confirmLeave);
    host.querySelector('[data-cancel]').addEventListener('click', confirmLeave);

    function confirmLeave() {
      if (!editor.nodes.length) { leave(); return; }
      UI.confirm({
        title: '离开编辑',
        message: '未保存的调整会丢失。',
        confirmText: '离开',
        cancelText: '继续编辑'
      }).then(function (ok) { if (ok) leave(); });
    }

    host.querySelector('[data-save]').addEventListener('click', function () {
      if (!editor.nodes.length) { UI.toast('画布还是空的', 'warn'); return; }
      promptSave(stage);
    });
  }

  function promptSave(stage) {
    var current = editor;
    UI.sheet({
      title: '保存搭配方案',
      content:
        '<div class="form">' +
          '<div class="field"><label for="o-name">方案名称</label>' +
            '<input id="o-name" class="input" data-name value="' + UI.esc(current.name) +
              '" placeholder="例如 秋日通勤" maxlength="30">' +
            '<p class="field-error" data-err hidden></p></div>' +
          '<div class="field"><label for="o-note">备注</label>' +
            '<textarea id="o-note" class="textarea" data-note maxlength="200" ' +
              'placeholder="场合、天气、想搭的鞋">' + UI.esc(current.note) + '</textarea></div>' +
        '</div>',
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '保存', className: 'btn--primary',
          onClick: function (body, close) {
            var name = body.querySelector('[data-name]').value.trim();
            if (!name) {
              var err = body.querySelector('[data-err]');
              err.textContent = '请填写方案名称';
              err.hidden = false;
              return;
            }
            current.name = name;
            current.note = body.querySelector('[data-note]').value;
            var btn = body.parentElement.querySelector('[data-action="1"]');
            if (btn) { btn.disabled = true; btn.textContent = '生成预览...'; }

            renderPreview(current.nodes).then(function (previewId) {
              var stale = current.previewId && current.previewId !== previewId
                ? [current.previewId] : [];
              var record = {
                id: current.id,
                name: current.name,
                note: current.note,
                nodes: current.nodes.map(function (n) {
                  return {
                    id: n.id, refType: n.refType, refId: n.refId, fullId: n.fullId,
                    ratio: n.ratio, wr: n.wr, xr: n.xr, yr: n.yr, z: n.z
                  };
                }),
                previewId: previewId,
                createdAt: current.createdAt,
                updatedAt: Date.now()
              };
              return global.Store.put(S.outfits, record).then(function () {
                return stale.length ? global.Store.delBlobs(stale) : null;
              });
            }).then(function () {
              UI.toast('搭配已保存');
              close();
              backToList();
            }).catch(function (e) {
              if (btn) { btn.disabled = false; btn.textContent = '保存'; }
              UI.toast(e.message || '保存失败', 'err');
            });
          }
        }
      ]
    });
  }

  /**
   * 生成搭配预览图。逐个节点顺序解码并立即释放，避免同时驻留多张位图。
   */
  function renderPreview(nodes) {
    var W_PX = 720, H_PX = 960;
    var canvas = document.createElement('canvas');
    canvas.width = W_PX;
    canvas.height = H_PX;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#F5F1EB';
    ctx.fillRect(0, 0, W_PX, H_PX);

    var ordered = nodes.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });

    var chain = Promise.resolve();
    ordered.forEach(function (n) {
      chain = chain.then(function () {
        return global.Store.getBlob(n.fullId).then(function (blob) {
          if (!blob) return null;
          return global.Img.decode(blob).then(function (bmp) {
            var w = n.wr * W_PX;
            var h = w * (n.ratio || 1.2);
            ctx.drawImage(bmp, n.xr * W_PX, n.yr * H_PX, w, h);
            global.Img.release(bmp);
          }).catch(function () { return null; });
        });
      });
    });

    return chain.then(function () {
      return global.Img.canvasToBlob(canvas, 'image/jpeg', 0.82);
    }).then(function (blob) {
      global.Img.disposeCanvas(canvas);
      var id = global.Store.uid('prev');
      return global.Store.putBlob({
        id: id, blob: blob, type: 'image/jpeg', size: blob.size, w: W_PX, h: H_PX
      });
    });
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  W.outfits = { render: render, openEditor: openEditor };
})(window);
