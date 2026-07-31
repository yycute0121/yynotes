/* ============================================================
   common.js · 三个模块共用的构件
   ------------------------------------------------------------
   - Cats   自定义分类管理（存 meta，可增删改，删除前检查占用）
   - Days   日期实时计算：使用天数、倒计时、状态分级
   - Fld    表单字段 HTML 生成器
   - Photos 多图管理（缩略图网格 + 添加 + 删除）
   所有日期计算基于本地时区，避免 UTC 造成日期偏一天。
   ============================================================ */
(function (global) {
  'use strict';

  var UI = global.UI;

  /* ============================================================
     分类管理
     ============================================================ */

  var Cats = {
    /** key: meta 键名；presets: 内置分类 */
    load: function (key, presets) {
      return global.Store.getMeta(key, null).then(function (saved) {
        if (Array.isArray(saved) && saved.length) return saved.slice();
        return presets.slice();
      });
    },

    save: function (key, list) {
      return global.Store.setMeta(key, list);
    },

    /**
     * 打开分类管理抽屉。
     * usage(name) -> Promise<number> 返回该分类下的记录数，用于删除前提示。
     */
    manage: function (options) {
      var opts = options || {};
      var key = opts.key;
      var presets = opts.presets || [];
      var list = [];

      function rowsHtml() {
        if (!list.length) {
          return '<p class="field-hint">还没有分类，先添加一个。</p>';
        }
        return '<div class="row-list">' + list.map(function (name, i) {
          return '<div class="row-card" data-i="' + i + '">' +
            '<div class="row-body"><p class="item-name">' + UI.esc(name) + '</p></div>' +
            '<div class="row-actions">' +
              '<button type="button" class="corner-btn" data-rename aria-label="重命名">' +
                UI.icon('edit', 14) + '</button>' +
              '<button type="button" class="corner-btn" data-remove aria-label="删除">' +
                UI.icon('trash', 14) + '</button>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
      }

      function shell() {
        return '<div class="form">' +
          '<div class="field">' +
            '<label for="cat-new">新增分类</label>' +
            '<div style="display:flex;gap:8px">' +
              '<input id="cat-new" class="input" data-new placeholder="输入分类名称" maxlength="12">' +
              '<button type="button" class="btn btn--soft" data-add style="flex:0 0 auto">添加</button>' +
            '</div>' +
            '<p class="field-error" data-err hidden></p>' +
          '</div>' +
          '<div class="field"><label>现有分类</label><div data-rows>' + rowsHtml() + '</div></div>' +
        '</div>';
      }

      Cats.load(key, presets).then(function (loaded) {
        list = loaded;
        var handle = UI.sheet({
          title: opts.title || '管理分类',
          content: shell(),
          actions: [{
            label: '完成', className: 'btn--primary',
            onClick: function (b, close) {
              Cats.save(key, list).then(function () {
                close();
                if (opts.onDone) opts.onDone(list);
              });
            }
          }],
          onClose: function () {
            Cats.save(key, list).then(function () {
              if (opts.onDone) opts.onDone(list);
            });
          }
        });

        var body = handle.body;

        function refresh() {
          body.querySelector('[data-rows]').innerHTML = rowsHtml();
          bind();
        }

        function showErr(msg) {
          var e = body.querySelector('[data-err]');
          e.textContent = msg;
          e.hidden = false;
        }

        function add() {
          var input = body.querySelector('[data-new]');
          var name = input.value.trim();
          if (!name) { showErr('请输入分类名称'); return; }
          if (list.indexOf(name) > -1) { showErr('这个分类已经存在'); return; }
          list.push(name);
          input.value = '';
          body.querySelector('[data-err]').hidden = true;
          refresh();
        }

        body.querySelector('[data-add]').addEventListener('click', add);
        body.querySelector('[data-new]').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); add(); }
        });

        function bind() {
          UI.on(body, '[data-rename]', 'click', function (e) {
            var i = Number(e.currentTarget.closest('[data-i]').dataset.i);
            var card = e.currentTarget.closest('.row-card');
            var old = list[i];
            card.querySelector('.row-body').innerHTML =
              '<input class="input" data-edit value="' + UI.esc(old) + '" maxlength="12">';
            var input = card.querySelector('[data-edit]');
            input.focus();
            function commit() {
              var next = input.value.trim();
              if (next && next !== old && list.indexOf(next) === -1) {
                list[i] = next;
                if (opts.onRename) opts.onRename(old, next);
              }
              refresh();
            }
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', function (ev) {
              if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            });
          });

          UI.on(body, '[data-remove]', 'click', function (e) {
            var i = Number(e.currentTarget.closest('[data-i]').dataset.i);
            var name = list[i];
            var usage = opts.usage ? opts.usage(name) : Promise.resolve(0);
            usage.then(function (n) {
              if (n > 0) {
                UI.confirm({
                  title: '分类正在使用中',
                  message: '「' + name + '」下还有 ' + n + ' 条记录。删除分类后，这些记录会移到「' +
                    (opts.fallback || '其他') + '」。',
                  confirmText: '仍然删除',
                  danger: true
                }).then(function (ok) {
                  if (!ok) return;
                  list.splice(i, 1);
                  var task = opts.onDelete ? opts.onDelete(name) : Promise.resolve();
                  Promise.resolve(task).then(refresh);
                });
              } else {
                list.splice(i, 1);
                refresh();
              }
            });
          });
        }

        bind();
      });
    }
  };

  /* ============================================================
     日期计算
     ============================================================ */

  var Days = {
    /** 从某天到今天的自然日天数，未来日期返回负数 */
    since: function (dateStr) {
      var d = UI.parseLocalDate(dateStr);
      if (!d) return null;
      return UI.daysBetween(d, UI.todayLocal());
    },

    /** 距离某天还有多少天，已过返回负数 */
    until: function (dateStr) {
      var d = UI.parseLocalDate(dateStr);
      if (!d) return null;
      return UI.daysBetween(UI.todayLocal(), d);
    },

    /** 在起始日期上加若干年，返回 yyyy-MM-dd */
    addYears: function (dateStr, years) {
      var d = UI.parseLocalDate(dateStr);
      if (!d || !years) return '';
      var t = new Date(d.getFullYear() + Number(years), d.getMonth(), d.getDate());
      return UI.dateStr(t);
    },

    /** 已使用天数文案 */
    usedText: function (dateStr) {
      var n = Days.since(dateStr);
      if (n === null) return '未设置购入日期';
      if (n < 0) return '购入日期在将来';
      if (n === 0) return '今天入手';
      return '已使用 ' + n + ' 天';
    },

    /**
     * 倒计时徽章。thresholds: [重点提醒天数, 轻提醒天数]
     * 返回 {text, cls}
     */
    countdown: function (dateStr, labels, thresholds) {
      var lb = labels || {};
      var th = thresholds || [7, 30];
      var n = Days.until(dateStr);
      if (n === null) return { text: lb.none || '未设置', cls: '' };
      if (n < 0) return { text: lb.over || ('已过期 ' + Math.abs(n) + ' 天'), cls: 'badge--risk' };
      if (n === 0) return { text: lb.today || '今天到期', cls: 'badge--risk' };
      if (n <= th[0]) return { text: '剩 ' + n + ' 天', cls: 'badge--risk' };
      if (n <= th[1]) return { text: '剩 ' + n + ' 天', cls: 'badge--warn' };
      return { text: '剩 ' + n + ' 天', cls: 'badge--ok' };
    }
  };

  /* ============================================================
     表单字段生成
     ============================================================ */

  var Fld = {
    text: function (id, label, value, opts) {
      var o = opts || {};
      return '<div class="field">' +
        '<label for="' + id + '">' + UI.esc(label) + '</label>' +
        '<input id="' + id + '" class="input" data-f="' + (o.name || id) + '" ' +
          'value="' + UI.esc(value || '') + '" ' +
          'placeholder="' + UI.esc(o.placeholder || '') + '" ' +
          'maxlength="' + (o.max || 40) + '"' +
          (o.inputmode ? ' inputmode="' + o.inputmode + '"' : '') + '>' +
        (o.hint ? '<p class="field-hint">' + UI.esc(o.hint) + '</p>' : '') +
        '<p class="field-error" data-err="' + (o.name || id) + '" hidden></p>' +
      '</div>';
    },

    number: function (id, label, value, opts) {
      var o = opts || {};
      return '<div class="field">' +
        '<label for="' + id + '">' + UI.esc(label) + '</label>' +
        '<input id="' + id + '" class="input" type="number" inputmode="decimal" ' +
          'data-f="' + (o.name || id) + '" value="' + UI.esc(value === 0 ? '0' : (value || '')) + '" ' +
          'min="' + (o.min !== undefined ? o.min : 0) + '" step="' + (o.step || '0.01') + '" ' +
          'placeholder="' + UI.esc(o.placeholder || '0') + '">' +
        (o.hint ? '<p class="field-hint">' + UI.esc(o.hint) + '</p>' : '') +
        '<p class="field-error" data-err="' + (o.name || id) + '" hidden></p>' +
      '</div>';
    },

    date: function (id, label, value, opts) {
      var o = opts || {};
      return '<div class="field">' +
        '<label for="' + id + '">' + UI.esc(label) + '</label>' +
        '<input id="' + id + '" class="input" type="date" data-f="' + (o.name || id) + '" ' +
          'value="' + UI.esc(value || '') + '">' +
        (o.hint ? '<p class="field-hint">' + UI.esc(o.hint) + '</p>' : '') +
      '</div>';
    },

    area: function (id, label, value, opts) {
      var o = opts || {};
      return '<div class="field">' +
        '<label for="' + id + '">' + UI.esc(label) + '</label>' +
        '<textarea id="' + id + '" class="textarea" data-f="' + (o.name || id) + '" ' +
          'maxlength="' + (o.max || 500) + '" ' +
          'placeholder="' + UI.esc(o.placeholder || '') + '"' +
          (o.rows ? ' rows="' + o.rows + '"' : '') + '>' + UI.esc(value || '') + '</textarea>' +
        (o.hint ? '<p class="field-hint">' + UI.esc(o.hint) + '</p>' : '') +
      '</div>';
    },

    /** 单选 chips。group 用于事件委托，value 为当前选中项 */
    chips: function (group, label, items, value, opts) {
      var o = opts || {};
      return '<div class="field">' +
        '<label>' + UI.esc(label) +
          (o.manageLabel
            ? ' <button type="button" class="link-btn" data-manage="' + group + '">' +
              UI.esc(o.manageLabel) + '</button>'
            : '') +
        '</label>' +
        '<div class="option-row" data-chips="' + group + '">' + items.map(function (it) {
          var v = typeof it === 'string' ? it : it.key;
          var t = typeof it === 'string' ? it : it.label;
          return '<button type="button" class="chip" data-v="' + UI.esc(v) + '" ' +
            'aria-pressed="' + (value === v) + '">' + UI.esc(t) + '</button>';
        }).join('') + '</div>' +
      '</div>';
    },

    /**
     * 绑定表单。draft 为草稿对象，字段通过 data-f 双向同步。
     * chipMap: {group: 'draftKey'}
     */
    bind: function (body, draft, chipMap) {
      body.querySelectorAll('[data-f]').forEach(function (input) {
        input.addEventListener('input', function () {
          draft[input.dataset.f] = input.value;
          var err = body.querySelector('[data-err="' + input.dataset.f + '"]');
          if (err) err.hidden = true;
        });
      });

      Object.keys(chipMap || {}).forEach(function (group) {
        var key = chipMap[group];
        UI.on(body, '[data-chips="' + group + '"] .chip', 'click', function (e) {
          draft[key] = e.currentTarget.dataset.v;
          body.querySelectorAll('[data-chips="' + group + '"] .chip').forEach(function (c) {
            c.setAttribute('aria-pressed', String(c.dataset.v === draft[key]));
          });
        });
      });
    },

    error: function (body, name, msg) {
      var e = body.querySelector('[data-err="' + name + '"]');
      if (e) { e.textContent = msg; e.hidden = false; }
      var input = body.querySelector('[data-f="' + name + '"]');
      if (input && input.focus) input.focus();
    }
  };

  /* ============================================================
     多图管理
     ============================================================ */

  var Photos = {
    /**
     * 渲染多图区域。list 为 [{fullId, thumbId, w, h}]
     */
    html: function (label, list, opts) {
      var o = opts || {};
      return '<div class="field">' +
        '<label>' + UI.esc(label) + '</label>' +
        '<div class="photo-grid" data-photos>' + Photos.items(list) + '</div>' +
        '<button type="button" class="btn btn--soft btn--sm" data-add-photo style="margin-top:8px">' +
          UI.icon('camera', 15) + (o.addLabel || '添加照片') + '</button>' +
        (o.hint ? '<p class="field-hint">' + UI.esc(o.hint) + '</p>' : '') +
      '</div>';
    },

    items: function (list) {
      if (!list || !list.length) {
        return '<p class="field-hint" data-empty>还没有照片</p>';
      }
      return list.map(function (p, i) {
        return '<div class="photo-cell" data-pi="' + i + '">' +
          '<img data-blob="' + UI.esc(p.thumbId || p.fullId) + '" data-group="common" ' +
            'alt="照片 ' + (i + 1) + '" loading="lazy" decoding="async">' +
          '<button type="button" class="corner-btn" data-del-photo aria-label="删除照片">' +
            UI.icon('close', 13) + '</button>' +
        '</div>';
      }).join('');
    },

    /**
     * 绑定多图交互。draft[key] 为图片数组，stale 收集待清理 blobId。
     */
    bind: function (body, draft, key, stale, pickerTitle) {
      function refresh() {
        var box = body.querySelector('[data-photos]');
        box.innerHTML = Photos.items(draft[key]);
        UI.bindLazyImages(box);
        bindCells();
      }

      function bindCells() {
        UI.on(body, '[data-del-photo]', 'click', function (e) {
          var i = Number(e.currentTarget.closest('[data-pi]').dataset.pi);
          var removed = draft[key].splice(i, 1)[0];
          if (removed) {
            if (removed.fullId) stale.push(removed.fullId);
            if (removed.thumbId) stale.push(removed.thumbId);
          }
          refresh();
        });
        UI.on(body, '.photo-cell img', 'click', function (e) {
          var i = Number(e.currentTarget.closest('[data-pi]').dataset.pi);
          var p = draft[key][i];
          if (!p) return;
          global.Img.url(p.fullId, 'common').then(function (url) {
            if (url) UI.viewer(url);
          });
        });
      }

      body.querySelector('[data-add-photo]').addEventListener('click', function () {
        global.Wardrobe.openImagePicker({ title: pickerTitle || '添加照片' }, function (res) {
          draft[key].push({
            fullId: res.fullId, thumbId: res.thumbId, w: res.w, h: res.h
          });
          refresh();
        });
      });

      UI.bindLazyImages(body);
      bindCells();
    }
  };

  /* ============================================================
     列表页脚手架
     ============================================================ */

  var List = {
    /** 搜索框 + 分类 chips 工具条 */
    toolbar: function (state, cats, opts) {
      var o = opts || {};
      var chips = ['全部'].concat(cats);
      return '<div class="toolbar">' +
        '<div class="search-box">' + UI.icon('search', 16) +
          '<input type="search" data-kw value="' + UI.esc(state.keyword || '') + '" ' +
            'placeholder="' + UI.esc(o.placeholder || '搜索') + '" aria-label="搜索">' +
          (state.keyword
            ? '<button type="button" class="clear-btn" data-kw-clear aria-label="清除">✕</button>'
            : '') +
        '</div>' +
        '<div class="chip-row" data-cat>' + chips.map(function (c) {
          return '<button type="button" class="chip" data-v="' + UI.esc(c) + '" ' +
            'aria-pressed="' + ((state.category || '全部') === c) + '">' + UI.esc(c) + '</button>';
        }).join('') + '</div>' +
      '</div>';
    },

    /** 绑定工具条 */
    bindToolbar: function (host, state, rerender) {
      var kw = host.querySelector('[data-kw]');
      if (kw) {
        kw.addEventListener('input', UI.debounce(function () {
          state.keyword = kw.value.trim();
          rerender();
        }, 260));
      }
      var clear = host.querySelector('[data-kw-clear]');
      if (clear) clear.addEventListener('click', function () {
        state.keyword = '';
        rerender();
      });
      UI.on(host, '[data-cat] .chip', 'click', function (e) {
        state.category = e.currentTarget.dataset.v;
        rerender();
      });
    },

    empty: function (icon, title, desc, btnLabel) {
      return '<div class="empty">' +
        '<div class="empty-glyph">' + UI.icon(icon, 24) + '</div>' +
        '<h3>' + UI.esc(title) + '</h3>' +
        '<p>' + UI.esc(desc) + '</p>' +
        (btnLabel
          ? '<button type="button" class="btn btn--primary" data-add>' +
            UI.icon('plus', 16) + UI.esc(btnLabel) + '</button>'
          : '') +
      '</div>';
    },

    noMatch: function () {
      return '<div class="empty"><h3>没有匹配的记录</h3>' +
        '<p>换个关键词或清掉筛选试试。</p>' +
        '<button type="button" class="btn btn--soft" data-reset>清除筛选</button></div>';
    },

    /** 关键词匹配：在给定字段里找 */
    match: function (row, keyword, fields) {
      if (!keyword) return true;
      var kw = keyword.toLowerCase();
      var hay = fields.map(function (f) { return row[f]; })
        .filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(kw) > -1;
    }
  };

  global.Common = {
    Cats: Cats,
    Days: Days,
    Fld: Fld,
    Photos: Photos,
    List: List
  };
})(window);
