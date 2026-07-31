/* ============================================================
   events.js · 事件记录本
   ------------------------------------------------------------
   两种模式：
     随手一记  极简笔记，可插图，没有预算与进度字段
     重大事件  项目模式，含任务清单、预算流水、时间规划、附件、日志
   任务与支出内嵌在项目文档内，单个项目子项有限，
   内嵌可让一次 put 保持整体一致，避免跨表事务。
   ============================================================ */
(function (global) {
  'use strict';

  var UI = global.UI;
  var C = global.Common;
  var S = global.Store.S;
  var GROUP = 'events';
  var CAT_KEY = 'projectCategories';

  var PRESETS = ['婚礼筹备', '买房置业', '旅行规划', '装修', '备考', '购车', '其他'];

  var TASK_STATES = [
    { key: 'todo', label: '待办' },
    { key: 'doing', label: '进行中' },
    { key: 'done', label: '已完成' }
  ];

  var state = { mode: 'notes', keyword: '', category: '全部' };
  var cats = PRESETS.slice();

  function listNotes() {
    return global.Store.getAll(S.notes).then(function (rows) {
      return rows.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    });
  }

  function listProjects() {
    return global.Store.getAll(S.projects).then(function (rows) {
      return rows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    });
  }

  /* ---------------- 项目派生计算 ---------------- */

  function progress(project) {
    var tasks = project.tasks || [];
    if (!tasks.length) return { pct: 0, done: 0, total: 0 };
    var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
    return { pct: Math.round((done / tasks.length) * 100), done: done, total: tasks.length };
  }

  function budget(project) {
    var total = Number(project.budget) || 0;
    var spent = (project.expenses || []).reduce(function (n, e) {
      return n + (Number(e.amount) || 0);
    }, 0);
    return {
      total: total,
      spent: spent,
      left: total - spent,
      pct: total > 0 ? Math.round((spent / total) * 100) : 0,
      over: total > 0 && spent > total
    };
  }

  function deadline(project) {
    if (!project.dueDate) return { text: '未设截止', cls: '' };
    var n = C.Days.until(project.dueDate);
    if (n < 0) return { text: '已超过目标 ' + Math.abs(n) + ' 天', cls: 'badge--risk' };
    if (n === 0) return { text: '今天到期', cls: 'badge--risk' };
    if (n <= 7) return { text: '剩 ' + n + ' 天', cls: 'badge--risk' };
    if (n <= 30) return { text: '剩 ' + n + ' 天', cls: 'badge--warn' };
    return { text: '剩 ' + n + ' 天', cls: 'badge--ok' };
  }

  function activeCount() {
    return listProjects().then(function (rows) {
      return rows.filter(function (p) {
        return progress(p).pct < 100;
      }).length;
    });
  }

  /* ============================================================
     入口渲染：模式切换
     ============================================================ */

  function render(host) {
    host.innerHTML =
      '<div class="segmented" role="tablist" data-mode>' +
        '<button type="button" role="tab" data-v="notes" aria-selected="' +
          (state.mode === 'notes') + '">随手一记</button>' +
        '<button type="button" role="tab" data-v="projects" aria-selected="' +
          (state.mode === 'projects') + '">重大事件</button>' +
      '</div><div data-sub></div>';

    UI.on(host, '[data-mode] button', 'click', function (e) {
      var v = e.currentTarget.dataset.v;
      if (v === state.mode) return;
      state.mode = v;
      state.keyword = '';
      state.category = '全部';
      render(host);
      if (global.App && global.App.refreshEventsFab) global.App.refreshEventsFab();
    });

    var sub = host.querySelector('[data-sub]');
    return state.mode === 'notes' ? renderNotes(sub) : renderProjects(sub);
  }

  /* ============================================================
     随手一记
     ============================================================ */

  function renderNotes(host) {
    host.innerHTML = '<div class="loading">加载笔记...</div>';

    return listNotes().then(function (rows) {
      var visible = rows.filter(function (r) {
        return C.List.match(r, state.keyword, ['title', 'body']);
      });

      var html = '<div class="toolbar"><div class="search-box">' + UI.icon('search', 16) +
        '<input type="search" data-kw value="' + UI.esc(state.keyword) +
        '" placeholder="搜索笔记内容" aria-label="搜索笔记">' +
        (state.keyword ? '<button type="button" class="clear-btn" data-kw-clear>✕</button>' : '') +
        '</div></div>';

      if (!rows.length) {
        html += C.List.empty('note', '还没有笔记',
          '随手记想法、灵感和日常小事，可以插图。', '写一条');
      } else if (!visible.length) {
        html += '<div class="empty"><h3>没有匹配的笔记</h3>' +
          '<p>换个关键词试试。</p></div>';
      } else {
        html += '<div class="row-list">' + visible.map(noteCard).join('') + '</div>';
      }

      host.innerHTML = html;
      UI.bindLazyImages(host);

      var rerender = function () { renderNotes(host); };
      var kw = host.querySelector('[data-kw]');
      if (kw) kw.addEventListener('input', UI.debounce(function () {
        state.keyword = kw.value.trim();
        rerender();
      }, 260));
      var clear = host.querySelector('[data-kw-clear]');
      if (clear) clear.addEventListener('click', function () { state.keyword = ''; rerender(); });

      var add = host.querySelector('[data-add]');
      if (add) add.addEventListener('click', function () { openNoteForm(null, rerender); });

      function find(id) { return rows.filter(function (r) { return r.id === id; })[0]; }

      UI.on(host, '[data-open]', 'click', function (e) {
        openNoteForm(find(e.currentTarget.closest('.row-card').dataset.id), rerender);
      });
      UI.on(host, '[data-del]', 'click', function (e) {
        e.stopPropagation();
        var row = find(e.currentTarget.closest('.row-card').dataset.id);
        if (!row) return;
        UI.confirm({
          title: '删除笔记',
          message: '这条笔记及其配图会被删除。',
          confirmText: '删除', danger: true
        }).then(function (ok) {
          if (!ok) return;
          global.Store.removeRecord(S.notes, row).then(function () {
            UI.toast('已删除');
            rerender();
          });
        });
      });

      return rows.length;
    });
  }

  function noteCard(row) {
    var cover = (row.images || [])[0];
    var excerpt = (row.body || '').replace(/\s+/g, ' ').slice(0, 60);
    return '<div class="row-card" data-id="' + UI.esc(row.id) + '">' +
      (cover
        ? '<div class="row-thumb"><img data-blob="' + UI.esc(cover.thumbId || cover.fullId) +
          '" data-group="' + GROUP + '" alt="" loading="lazy" decoding="async"></div>'
        : '') +
      '<div class="row-body" data-open>' +
        '<p class="item-name">' + UI.esc(row.title || excerpt || '无标题') + '</p>' +
        (row.title && excerpt ? '<p class="task-meta">' + UI.esc(excerpt) + '</p>' : '') +
        '<p class="item-sub"><span class="badge">' +
          UI.fmtDate(UI.dateStr(new Date(row.createdAt))) + '</span>' +
          ((row.images || []).length
            ? '<span class="badge badge--soft">' + row.images.length + ' 张图</span>'
            : '') +
        '</p>' +
      '</div>' +
      '<div class="row-actions">' +
        '<button type="button" class="corner-btn" data-del aria-label="删除">' +
          UI.icon('trash', 14) + '</button>' +
      '</div>' +
    '</div>';
  }

  function openNoteForm(row, onDone) {
    var editing = !!row;
    var draft = {
      id: editing ? row.id : global.Store.uid('note'),
      title: editing ? (row.title || '') : '',
      body: editing ? (row.body || '') : '',
      images: editing ? (row.images || []).slice() : [],
      createdAt: editing ? row.createdAt : Date.now()
    };
    var stale = [];

    var html = '<div class="form">' +
      C.Fld.text('n-title', '标题', draft.title, {
        name: 'title', placeholder: '可留空', max: 40
      }) +
      C.Fld.area('n-body', '内容', draft.body, {
        name: 'body', placeholder: '随手写点什么', max: 2000, rows: 6
      }) +
      C.Photos.html('配图', draft.images, { addLabel: '插入图片' }) +
    '</div>';

    var handle = UI.sheet({
      title: editing ? '编辑笔记' : '写一条',
      content: html,
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '保存', className: 'btn--primary',
          onClick: function (body, close) {
            if (!draft.title.trim() && !draft.body.trim() && !draft.images.length) {
              UI.toast('写点内容或加张图再保存', 'warn');
              return;
            }
            draft.title = draft.title.trim();
            draft.updatedAt = Date.now();
            global.Store.put(S.notes, draft).then(function () {
              return stale.length ? global.Store.delBlobs(stale) : null;
            }).then(function () {
              UI.toast(editing ? '已更新' : '已保存');
              close();
              if (onDone) onDone();
            });
          }
        }
      ]
    });

    C.Fld.bind(handle.body, draft, {});
    C.Photos.bind(handle.body, draft, 'images', stale, '笔记配图');
  }

  /* ============================================================
     重大事件列表
     ============================================================ */

  function renderProjects(host) {
    host.innerHTML = '<div class="loading">加载项目...</div>';

    return C.Cats.load(CAT_KEY, PRESETS).then(function (loaded) {
      cats = loaded;
      return listProjects();
    }).then(function (rows) {
      var visible = rows.filter(function (r) {
        if (state.category !== '全部' && r.category !== state.category) return false;
        return C.List.match(r, state.keyword, ['name', 'brief', 'category']);
      });

      var html = C.List.toolbar(state, cats, { placeholder: '搜索项目名称' });
      html += '<div class="chip-row" style="margin:-4px 0 16px">' +
        '<button type="button" class="chip" data-manage-cats>' +
          UI.icon('grid', 12) + ' 管理分类</button></div>';

      if (!rows.length) {
        html += C.List.empty('layers', '还没有重大事件',
          '婚礼、装修、旅行这类事，用项目模式跟踪任务与预算。', '新建项目');
      } else if (!visible.length) {
        html += C.List.noMatch();
      } else {
        html += '<div class="row-list">' + visible.map(projectCard).join('') + '</div>';
      }

      host.innerHTML = html;
      UI.bindLazyImages(host);

      var rerender = function () { renderProjects(host); };
      C.List.bindToolbar(host, state, rerender);

      var mc = host.querySelector('[data-manage-cats]');
      if (mc) mc.addEventListener('click', function () { manageCats(rerender); });

      var reset = host.querySelector('[data-reset]');
      if (reset) reset.addEventListener('click', function () {
        state.keyword = ''; state.category = '全部'; rerender();
      });

      var add = host.querySelector('[data-add]');
      if (add) add.addEventListener('click', function () { openProjectForm(null, rerender); });

      UI.on(host, '[data-open]', 'click', function (e) {
        var id = e.currentTarget.closest('.row-card').dataset.id;
        // 走路由而不是直接调用：项目详情会整页接管，
        // 有独立 hash 才能让浏览器与手机系统返回键正常工作
        location.hash = '#/events/projects/' + encodeURIComponent(id);
      });

      return rows.length;
    });
  }

  function projectCard(p) {
    var pr = progress(p);
    var bg = budget(p);
    var dl = deadline(p);
    var cover = p.coverThumbId || p.coverFullId;

    return '<div class="row-card" data-id="' + UI.esc(p.id) + '" style="align-items:stretch">' +
      (cover
        ? '<div class="row-thumb"><img data-blob="' + UI.esc(cover) + '" data-group="' + GROUP +
          '" alt="" loading="lazy" decoding="async"></div>'
        : '') +
      '<div class="row-body" data-open>' +
        '<p class="item-name">' + UI.esc(p.name || '未命名项目') + '</p>' +
        '<p class="item-sub">' +
          '<span class="badge">' + UI.esc(p.category || '其他') + '</span>' +
          '<span class="badge ' + dl.cls + '">' + UI.esc(dl.text) + '</span>' +
          (bg.total ? '<span class="badge ' + (bg.over ? 'badge--risk' : '') + '">' +
            (bg.over ? '超预算' : '预算 ' + bg.pct + '%') + '</span>' : '') +
        '</p>' +
        (pr.total
          ? '<div class="progress"><div class="progress-track">' +
            '<i style="width:' + pr.pct + '%"></i></div>' +
            '<span class="progress-num">' + pr.done + '/' + pr.total + '</span></div>'
          : '<p class="task-meta">还没有任务</p>') +
      '</div>' +
    '</div>';
  }

  function manageCats(onDone) {
    C.Cats.manage({
      key: CAT_KEY,
      presets: PRESETS,
      title: '管理事件分类',
      fallback: '其他',
      usage: function (name) {
        return listProjects().then(function (rows) {
          return rows.filter(function (r) { return r.category === name; }).length;
        });
      },
      onDelete: function (name) {
        return listProjects().then(function (rows) {
          return Promise.all(rows.filter(function (r) { return r.category === name; })
            .map(function (r) {
              r.category = '其他';
              r.updatedAt = Date.now();
              return global.Store.put(S.projects, r);
            }));
        });
      },
      onRename: function (from, to) {
        return listProjects().then(function (rows) {
          return Promise.all(rows.filter(function (r) { return r.category === from; })
            .map(function (r) {
              r.category = to;
              r.updatedAt = Date.now();
              return global.Store.put(S.projects, r);
            }));
        });
      },
      onDone: function () { if (onDone) onDone(); }
    });
  }

  /* ============================================================
     项目表单
     ============================================================ */

  function openProjectForm(p, onDone) {
    var editing = !!p;
    var draft = {
      id: editing ? p.id : global.Store.uid('proj'),
      name: editing ? (p.name || '') : '',
      category: editing ? (p.category || cats[0]) : cats[0],
      brief: editing ? (p.brief || '') : '',
      startDate: editing ? (p.startDate || '') : UI.dateStr(),
      dueDate: editing ? (p.dueDate || '') : '',
      budget: editing ? (p.budget || '') : '',
      coverFullId: editing ? p.coverFullId : null,
      coverThumbId: editing ? p.coverThumbId : null,
      tasks: editing ? (p.tasks || []) : [],
      expenses: editing ? (p.expenses || []) : [],
      logs: editing ? (p.logs || []) : [],
      attachments: editing ? (p.attachments || []) : [],
      createdAt: editing ? p.createdAt : Date.now()
    };
    var stale = [];

    var Fld = C.Fld;
    var html = '<div class="form">' +
      '<div class="field"><label>封面</label>' +
        '<div class="picker-preview" data-cover>' +
          (draft.coverFullId
            ? '<img data-blob="' + UI.esc(draft.coverFullId) + '" data-group="' + GROUP + '" alt="封面">'
            : '<div class="loading">还没有封面</div>') +
        '</div>' +
        '<button type="button" class="btn btn--soft btn--sm" data-pick-cover style="margin-top:8px">' +
          UI.icon('image', 15) + (draft.coverFullId ? '更换封面' : '添加封面') + '</button>' +
      '</div>' +
      Fld.text('p-name', '项目名称', draft.name, {
        name: 'name', placeholder: '例如 2027 春季婚礼', max: 40
      }) +
      Fld.chips('cat', '分类', cats, draft.category, { manageLabel: '管理分类' }) +
      Fld.area('p-brief', '项目简介', draft.brief, {
        name: 'brief', placeholder: '这件事的目标和范围', max: 400
      }) +
      '<div class="field-2col">' +
        Fld.date('p-start', '开始日期', draft.startDate, { name: 'startDate' }) +
        Fld.date('p-due', '目标截止', draft.dueDate, { name: 'dueDate' }) +
      '</div>' +
      '<div data-derived class="io-summary"></div>' +
      Fld.number('p-budget', '总预算', draft.budget, {
        name: 'budget', hint: '填写后可在项目里逐笔记录支出'
      }) +
    '</div>';

    var handle = UI.sheet({
      title: editing ? '编辑项目' : '新建项目',
      content: html,
      actions: [
        { label: '取消', className: 'btn--ghost' },
        {
          label: '保存', className: 'btn--primary',
          onClick: function (body, close) {
            if (!draft.name.trim()) { Fld.error(body, 'name', '请填写项目名称'); return; }
            draft.name = draft.name.trim();
            draft.updatedAt = Date.now();
            global.Store.put(S.projects, draft).then(function () {
              return stale.length ? global.Store.delBlobs(stale) : null;
            }).then(function () {
              UI.toast(editing ? '已更新' : '已创建');
              close();
              if (onDone) onDone(draft);
            });
          }
        }
      ]
    });

    var body = handle.body;
    Fld.bind(body, draft, { cat: 'category' });
    UI.bindLazyImages(body);

    function refreshDerived() {
      var box = body.querySelector('[data-derived]');
      if (!draft.dueDate) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = '<div><span>距目标截止</span><b>' +
        UI.esc(deadline(draft).text) + '</b></div>';
    }
    var due = body.querySelector('[data-f="dueDate"]');
    if (due) due.addEventListener('input', refreshDerived);
    refreshDerived();

    body.querySelector('[data-pick-cover]').addEventListener('click', function () {
      global.Wardrobe.openImagePicker({ title: '项目封面' }, function (res) {
        if (draft.coverFullId) stale.push(draft.coverFullId, draft.coverThumbId);
        draft.coverFullId = res.fullId;
        draft.coverThumbId = res.thumbId;
        var wrap = body.querySelector('[data-cover]');
        wrap.innerHTML = '<img data-blob="' + UI.esc(res.fullId) + '" data-group="' +
          GROUP + '" alt="封面">';
        UI.bindLazyImages(wrap);
        body.querySelector('[data-pick-cover]').innerHTML =
          UI.icon('image', 15) + '更换封面';
      });
    });

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
          Fld.bind(body, draft, { cat: 'category' });
        });
      });
    });
  }

  global.Events = {
    state: state,
    PRESETS: PRESETS,
    CAT_KEY: CAT_KEY,
    TASK_STATES: TASK_STATES,
    render: render,
    renderNotes: renderNotes,
    renderProjects: renderProjects,
    openNoteForm: openNoteForm,
    openProjectForm: openProjectForm,
    progress: progress,
    budget: budget,
    deadline: deadline,
    activeCount: activeCount,
    listNotes: listNotes,
    listProjects: listProjects
  };
})(window);

/* ============================================================
   events.project.js · 项目详情（任务 / 预算 / 附件 / 日志）
   ============================================================ */
(function (global) {
  'use strict';

  var UI = global.UI;
  var C = global.Common;
  var S = global.Store.S;
  var E = global.Events;
  var GROUP = 'events';

  var NEXT_STATE = { todo: 'doing', doing: 'done', done: 'todo' };
  var STATE_ICON = { todo: 'plus', doing: 'edit', done: 'check' };

  var LIST_HASH = '#/events/projects';

  /**
   * 项目详情用整页展示，子项较多，抽屉里放不开。
   * 因为整页接管了 #app，返回必须走路由重建页面，
   * 不能回调外层列表的容器节点（那个节点此时已被替换掉）。
   */
  function openProject(project) {
    if (!project) return;
    var host = document.getElementById('app');
    var p = project;

    function backToList() {
      global.Img.releaseGroup(GROUP);
      if (location.hash === LIST_HASH) global.App.renderEvents();
      else location.hash = LIST_HASH;
    }

    function save() {
      p.updatedAt = Date.now();
      return global.Store.put(S.projects, p);
    }

    function draw() {
      var pr = E.progress(p);
      var bg = E.budget(p);
      var dl = E.deadline(p);

      host.innerHTML =
        '<div class="topbar">' +
          '<button type="button" class="icon-btn" data-back aria-label="返回">' +
            UI.icon('back', 18) + '</button>' +
          '<div class="topbar-title"><h1>' + UI.esc(p.name || '未命名项目') + '</h1>' +
            '<p>' + UI.esc(p.category || '其他') + ' · ' + UI.esc(dl.text) + '</p></div>' +
          '<button type="button" class="icon-btn" data-edit aria-label="编辑项目">' +
            UI.icon('edit', 18) + '</button>' +
        '</div>' +

        (p.coverFullId
          ? '<div class="picker-preview" style="margin-bottom:16px">' +
            '<img data-blob="' + UI.esc(p.coverFullId) + '" data-group="' + GROUP +
            '" alt="封面"></div>'
          : '') +

        (p.brief
          ? '<p style="margin:0 0 16px;font-size:13px;color:var(--ink-2);line-height:1.7">' +
            UI.esc(p.brief) + '</p>'
          : '') +

        '<div class="stat-row">' +
          '<div class="stat"><b>' + pr.pct + '%</b><span>整体进度</span></div>' +
          '<div class="stat"><b>' + pr.done + '/' + pr.total + '</b><span>任务完成</span></div>' +
          '<div class="stat"><b>' + (p.dueDate ? UI.fmtDate(p.dueDate).slice(5) : '—') +
            '</b><span>目标日期</span></div>' +
        '</div>' +

        tasksPanel(p, pr) +
        budgetPanel(p, bg) +
        attachPanel(p) +
        logsPanel(p) +

        '<div class="btn-row" style="margin-top:20px">' +
          '<button type="button" class="btn btn--danger" data-del-project>删除项目</button>' +
        '</div>' +
        '<p class="page-foot">项目资料与附件都只保存在本机</p>';

      UI.bindLazyImages(host);
      bind();
    }

    /* ---------------- 任务清单 ---------------- */

    function tasksPanel(p, pr) {
      var tasks = p.tasks || [];
      var html = '<div class="panel">' +
        '<div class="panel-head"><h3>任务清单</h3>' +
          '<button type="button" class="btn btn--soft btn--sm" data-add-task>' +
            UI.icon('plus', 14) + '加任务</button>' +
        '</div>';

      if (pr.total) {
        html += '<div class="progress"><div class="progress-track">' +
          '<i style="width:' + pr.pct + '%"></i></div>' +
          '<span class="progress-num">' + pr.pct + '%</span></div>';
      }

      if (!tasks.length) {
        html += '<p class="panel-empty">还没有任务，拆几个小步骤出来</p>';
      } else {
        html += tasks.map(function (t, i) {
          var dueTxt = '';
          if (t.due) {
            var n = C.Days.until(t.due);
            dueTxt = n < 0 ? '已超期 ' + Math.abs(n) + ' 天'
              : n === 0 ? '今天' : '还有 ' + n + ' 天';
          }
          return '<div class="task-row' + (t.status === 'done' ? ' is-done' : '') +
            '" data-ti="' + i + '">' +
            '<button type="button" class="state-dot" data-state="' + t.status +
              '" data-toggle aria-label="切换状态">' +
              UI.icon(STATE_ICON[t.status] || 'plus', 14) + '</button>' +
            '<div>' +
              '<div class="task-name">' + UI.esc(t.title) + '</div>' +
              (dueTxt || t.note
                ? '<div class="task-meta">' +
                  [dueTxt, t.note].filter(Boolean).map(UI.esc).join(' · ') + '</div>'
                : '') +
            '</div>' +
            '<button type="button" class="corner-btn" data-edit-task aria-label="编辑">' +
              UI.icon('edit', 13) + '</button>' +
            '<button type="button" class="corner-btn" data-del-task aria-label="删除">' +
              UI.icon('trash', 13) + '</button>' +
          '</div>';
        }).join('');
      }
      return html + '</div>';
    }

    /* ---------------- 预算 ---------------- */

    function budgetPanel(p, bg) {
      var list = (p.expenses || []).slice().sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });

      var html = '<div class="panel">' +
        '<div class="panel-head"><h3>预算管理</h3>' +
          '<button type="button" class="btn btn--soft btn--sm" data-add-expense>' +
            UI.icon('plus', 14) + '记一笔</button>' +
        '</div>';

      if (!bg.total && !list.length) {
        html += '<p class="panel-empty">还没设预算，可在编辑项目里填写总预算</p>';
      } else {
        html += '<div class="money-total">' +
          '<div><b>' + (bg.total ? UI.money(bg.total) : '—') + '</b><span>总预算</span></div>' +
          '<div><b>' + UI.money(bg.spent) + '</b><span>已花费</span></div>' +
          '<div><b class="' + (bg.over ? 'is-over' : '') + '">' +
            (bg.total ? UI.money(bg.left) : '—') + '</b><span>' +
            (bg.over ? '已超支' : '剩余') + '</span></div>' +
        '</div>';

        if (bg.total) {
          html += '<div class="progress"><div class="progress-track' +
            (bg.over ? ' is-over' : '') + '">' +
            '<i style="width:' + Math.min(100, bg.pct) + '%"></i></div>' +
            '<span class="progress-num">' + bg.pct + '%</span></div>';
        }

        if (!list.length) {
          html += '<p class="panel-empty">还没有支出记录</p>';
        } else {
          html += list.map(function (e, i) {
            return '<div class="money-row" data-ei="' + UI.esc(e.id) + '">' +
              '<span>' + UI.esc(e.name) +
                '<span class="sub"> ' + UI.fmtDate(e.date) +
                (e.category ? ' · ' + UI.esc(e.category) : '') + '</span></span>' +
              '<span><b>' + UI.money(e.amount) + '</b> ' +
                '<button type="button" class="corner-btn" data-del-expense aria-label="删除">' +
                  UI.icon('trash', 12) + '</button></span>' +
            '</div>';
          }).join('');
        }
      }
      return html + '</div>';
    }

    /* ---------------- 附件 ---------------- */

    function attachPanel(p) {
      var list = p.attachments || [];
      var html = '<div class="panel">' +
        '<div class="panel-head"><h3>素材附件</h3>' +
          '<button type="button" class="btn btn--soft btn--sm" data-add-file>' +
            UI.icon('plus', 14) + '上传</button>' +
        '</div>';
      if (!list.length) {
        html += '<p class="panel-empty">合同、报价、截图都可以放这里</p>';
      } else {
        html += list.map(function (a) {
          return '<div class="money-row" data-ai="' + UI.esc(a.id) + '">' +
            '<span>' + UI.esc(a.name) +
              '<span class="sub"> ' + UI.bytes(a.size || 0) + '</span></span>' +
            '<span>' +
              '<button type="button" class="corner-btn" data-open-file aria-label="打开">' +
                UI.icon('image', 12) + '</button> ' +
              '<button type="button" class="corner-btn" data-del-file aria-label="删除">' +
                UI.icon('trash', 12) + '</button>' +
            '</span>' +
          '</div>';
        }).join('');
      }
      return html + '</div>';
    }

    /* ---------------- 日志 ---------------- */

    function logsPanel(p) {
      var list = (p.logs || []).slice().reverse();
      var html = '<div class="panel">' +
        '<div class="panel-head"><h3>日志备注</h3>' +
          '<button type="button" class="btn btn--soft btn--sm" data-add-log>' +
            UI.icon('plus', 14) + '写日志</button>' +
        '</div>';
      if (!list.length) {
        html += '<p class="panel-empty">记录沟通结果与重要决定</p>';
      } else {
        html += list.map(function (l) {
          return '<div style="padding:10px 0;border-bottom:1px solid var(--line-soft)" ' +
            'data-li="' + UI.esc(l.id) + '">' +
            '<div style="display:flex;justify-content:space-between;gap:8px">' +
              '<b style="font-size:12px;color:var(--ink-muted)">' + UI.fmtDate(l.date) + '</b>' +
              '<button type="button" class="corner-btn" data-del-log aria-label="删除">' +
                UI.icon('trash', 12) + '</button>' +
            '</div>' +
            '<div style="font-size:13px;line-height:1.7;margin-top:4px">' +
              UI.esc(l.content) + '</div>' +
          '</div>';
        }).join('');
      }
      return html + '</div>';
    }

    /* ---------------- 事件绑定 ---------------- */

    function bind() {
      host.querySelector('[data-back]').addEventListener('click', backToList);

      host.querySelector('[data-edit]').addEventListener('click', function () {
        E.openProjectForm(p, function () {
          // 表单返回的是同一份草稿结构，重新读库确保一致
          global.Store.get(S.projects, p.id).then(function (fresh) {
            if (fresh) p = fresh;
            draw();
          });
        });
      });

      host.querySelector('[data-del-project]').addEventListener('click', function () {
        UI.confirm({
          title: '删除项目',
          message: '「' + (p.name || '未命名项目') +
            '」的任务、支出、日志和附件都会被删除。',
          detail: '此操作不可恢复。',
          confirmText: '删除', danger: true
        }).then(function (ok) {
          if (!ok) return;
          global.Store.removeRecord(S.projects, p).then(function () {
            UI.toast('已删除项目');
            backToList();
          });
        });
      });

      /* 任务 */
      host.querySelector('[data-add-task]').addEventListener('click', function () {
        taskForm(null, function (task) {
          p.tasks = (p.tasks || []).concat([task]);
          save().then(draw);
        });
      });

      UI.on(host, '[data-toggle]', 'click', function (e) {
        var i = Number(e.currentTarget.closest('[data-ti]').dataset.ti);
        var t = p.tasks[i];
        if (!t) return;
        t.status = NEXT_STATE[t.status] || 'todo';
        save().then(draw);
      });

      UI.on(host, '[data-edit-task]', 'click', function (e) {
        var i = Number(e.currentTarget.closest('[data-ti]').dataset.ti);
        taskForm(p.tasks[i], function (task) {
          p.tasks[i] = task;
          save().then(draw);
        });
      });

      UI.on(host, '[data-del-task]', 'click', function (e) {
        var i = Number(e.currentTarget.closest('[data-ti]').dataset.ti);
        p.tasks.splice(i, 1);
        save().then(draw);
      });

      /* 支出 */
      host.querySelector('[data-add-expense]').addEventListener('click', function () {
        expenseForm(function (exp) {
          p.expenses = (p.expenses || []).concat([exp]);
          save().then(function () {
            var bg = E.budget(p);
            if (bg.over) UI.toast('已超出总预算', 'warn');
            draw();
          });
        });
      });

      UI.on(host, '[data-del-expense]', 'click', function (e) {
        var id = e.currentTarget.closest('[data-ei]').dataset.ei;
        p.expenses = (p.expenses || []).filter(function (x) { return x.id !== id; });
        save().then(draw);
      });

      /* 附件 */
      host.querySelector('[data-add-file]').addEventListener('click', pickFile);

      UI.on(host, '[data-open-file]', 'click', function (e) {
        var id = e.currentTarget.closest('[data-ai]').dataset.ai;
        var a = (p.attachments || []).filter(function (x) { return x.id === id; })[0];
        if (!a) return;
        global.Store.getBlob(a.blobId).then(function (blob) {
          if (!blob) { UI.toast('附件已丢失', 'err'); return; }
          if ((a.mime || '').indexOf('image/') === 0) {
            global.Img.url(a.blobId, GROUP).then(function (url) {
              if (url) UI.viewer(url);
            });
          } else {
            // 非图片直接触发下载，交给系统应用打开
            global.Backup.download(blob, a.name);
          }
        });
      });

      UI.on(host, '[data-del-file]', 'click', function (e) {
        var id = e.currentTarget.closest('[data-ai]').dataset.ai;
        var a = (p.attachments || []).filter(function (x) { return x.id === id; })[0];
        if (!a) return;
        UI.confirm({
          title: '删除附件',
          message: '「' + a.name + '」会被删除。',
          confirmText: '删除', danger: true
        }).then(function (ok) {
          if (!ok) return;
          p.attachments = p.attachments.filter(function (x) { return x.id !== id; });
          global.Img.releaseOne(a.blobId);
          global.Store.delBlob(a.blobId).then(save).then(draw);
        });
      });

      /* 日志 */
      host.querySelector('[data-add-log]').addEventListener('click', function () {
        logForm(function (log) {
          p.logs = (p.logs || []).concat([log]);
          save().then(draw);
        });
      });

      UI.on(host, '[data-del-log]', 'click', function (e) {
        var id = e.currentTarget.closest('[data-li]').dataset.li;
        p.logs = (p.logs || []).filter(function (x) { return x.id !== id; });
        save().then(draw);
      });
    }

    /* ---------------- 子表单 ---------------- */

    function taskForm(task, onOk) {
      var editing = !!task;
      var draft = {
        id: editing ? task.id : global.Store.uid('task'),
        title: editing ? task.title : '',
        status: editing ? task.status : 'todo',
        due: editing ? (task.due || '') : '',
        note: editing ? (task.note || '') : '',
        createdAt: editing ? task.createdAt : Date.now()
      };

      var handle = UI.sheet({
        title: editing ? '编辑任务' : '添加任务',
        content: '<div class="form">' +
          C.Fld.text('t-title', '任务内容', draft.title, {
            name: 'title', placeholder: '例如 预订场地', max: 60
          }) +
          C.Fld.chips('st', '状态', E.TASK_STATES, draft.status) +
          C.Fld.date('t-due', '截止日期', draft.due, { name: 'due' }) +
          C.Fld.text('t-note', '备注', draft.note, {
            name: 'note', placeholder: '可留空', max: 60
          }) +
        '</div>',
        actions: [
          { label: '取消', className: 'btn--ghost' },
          {
            label: '保存', className: 'btn--primary',
            onClick: function (b, close) {
              if (!draft.title.trim()) { C.Fld.error(b, 'title', '请填写任务内容'); return; }
              draft.title = draft.title.trim();
              close();
              onOk(draft);
            }
          }
        ]
      });
      C.Fld.bind(handle.body, draft, { st: 'status' });
    }

    function expenseForm(onOk) {
      var draft = {
        id: global.Store.uid('exp'),
        name: '', amount: '', date: UI.dateStr(), category: '', note: '',
        createdAt: Date.now()
      };
      var handle = UI.sheet({
        title: '记一笔支出',
        content: '<div class="form">' +
          C.Fld.text('e-name', '支出项目', draft.name, {
            name: 'name', placeholder: '例如 场地定金', max: 40
          }) +
          C.Fld.number('e-amount', '金额', draft.amount, { name: 'amount' }) +
          '<div class="field-2col">' +
            C.Fld.date('e-date', '日期', draft.date, { name: 'date' }) +
            C.Fld.text('e-cat', '归类', draft.category, {
              name: 'category', placeholder: '可留空', max: 20
            }) +
          '</div>' +
          C.Fld.text('e-note', '备注', draft.note, { name: 'note', max: 60 }) +
        '</div>',
        actions: [
          { label: '取消', className: 'btn--ghost' },
          {
            label: '保存', className: 'btn--primary',
            onClick: function (b, close) {
              if (!draft.name.trim()) { C.Fld.error(b, 'name', '请填写支出项目'); return; }
              var amt = Number(draft.amount);
              if (!amt || amt <= 0) { C.Fld.error(b, 'amount', '请输入大于 0 的金额'); return; }
              draft.name = draft.name.trim();
              draft.amount = amt;
              close();
              onOk(draft);
            }
          }
        ]
      });
      C.Fld.bind(handle.body, draft, {});
    }

    function logForm(onOk) {
      var draft = {
        id: global.Store.uid('log'),
        date: UI.dateStr(), content: '', createdAt: Date.now()
      };
      var handle = UI.sheet({
        title: '写日志',
        content: '<div class="form">' +
          C.Fld.date('l-date', '日期', draft.date, { name: 'date' }) +
          C.Fld.area('l-content', '内容', draft.content, {
            name: 'content', placeholder: '沟通结果、重要决定、注意事项', max: 1000, rows: 5
          }) +
        '</div>',
        actions: [
          { label: '取消', className: 'btn--ghost' },
          {
            label: '保存', className: 'btn--primary',
            onClick: function (b, close) {
              if (!draft.content.trim()) { UI.toast('写点内容再保存', 'warn'); return; }
              draft.content = draft.content.trim();
              close();
              onOk(draft);
            }
          }
        ]
      });
      C.Fld.bind(handle.body, draft, {});
    }

    /** 附件上传：图片走压缩，其他类型原样保存 */
    function pickFile() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.remove();
        if (!file) return;

        var MAX = 25 * 1024 * 1024;
        if (file.size > MAX) {
          UI.toast('附件超过 25MB，建议先压缩', 'err');
          return;
        }

        UI.toast('正在保存附件...');
        var isImage = (file.type || '').indexOf('image/') === 0;

        var task = isImage
          ? global.Img.decode(file).then(function (src) {
              return global.Img.persist(src, { alpha: false }).then(function (res) {
                global.Img.release(src);
                return { blobId: res.fullId, size: res.bytes, mime: file.type };
              });
            })
          : (function () {
              var id = global.Store.uid('file');
              return global.Store.putBlob({
                id: id, blob: file, type: file.type || 'application/octet-stream',
                size: file.size
              }).then(function () {
                return { blobId: id, size: file.size, mime: file.type };
              });
            })();

        task.then(function (r) {
          p.attachments = (p.attachments || []).concat([{
            id: global.Store.uid('att'),
            name: file.name,
            blobId: r.blobId,
            mime: r.mime || '',
            size: r.size || file.size,
            createdAt: Date.now()
          }]);
          return save();
        }).then(function () {
          UI.toast('附件已保存');
          draw();
        }).catch(function (err) {
          UI.toast(err.message || '附件保存失败', 'err');
        });
      });

      input.click();
    }

    draw();
  }

  global.Events.openProject = openProject;
})(window);
