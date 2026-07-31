/* ============================================================
   health.js · 数据健康：存储用量预警与备份新鲜度提醒
   ------------------------------------------------------------
   两件事：
   1. 存储用量分级。本地配额有限，照片和附件占大头，
      接近上限时写入会直接失败，所以要提前预警。
   2. 备份新鲜度。数据只在本机，清理浏览器数据即全部丢失，
      因此按天数与「是否有新记录」双重判断，提醒导出备份。
   提醒只在界面上显示，不发起任何网络请求。
   ============================================================ */
(function (global) {
  'use strict';

  var UI = global.UI;

  var K = {
    lastAt: 'backupLastAt',        // 上次导出时间（ISO 字符串）
    lastTotal: 'backupLastTotal',  // 上次导出时的记录总数
    reminder: 'backupReminderDays',// 提醒周期，0 表示关闭
    dismissed: 'noticeDismissedOn' // 当天已忽略提醒的日期
  };

  var DEFAULT_DAYS = 14;
  var REMINDER_OPTIONS = [
    { key: 7, label: '每 7 天' },
    { key: 14, label: '每 14 天' },
    { key: 30, label: '每 30 天' },
    { key: 0, label: '不提醒' }
  ];

  /* ---------------- 存储用量 ---------------- */

  /**
   * 用量分级。除了百分比，还看剩余绝对空间：
   * 配额很大时 60% 也不紧张，配额很小时剩不到 50MB 就该提醒了。
   */
  function storage() {
    return Promise.all([
      global.Store.estimate(),
      global.Store.count(global.Store.S.blobs).catch(function () { return 0; })
    ]).then(function (r) {
      var est = r[0];
      var images = r[1];
      if (!est || !est.quota) {
        return {
          supported: false, images: images,
          level: 'ok', label: '无法读取用量',
          hint: '这个浏览器不支持读取存储配额，已保存 ' + images + ' 个图片附件。'
        };
      }

      var usage = est.usage || 0;
      var quota = est.quota;
      var pct = Math.min(100, (usage / quota) * 100);
      var freeMB = (quota - usage) / (1024 * 1024);

      var level = 'ok';
      if (pct >= 85 || freeMB < 50) level = 'risk';
      else if (pct >= 65 || freeMB < 200) level = 'warn';

      var label = level === 'risk' ? '存储紧张'
        : level === 'warn' ? '存储偏高' : '存储充足';

      var hint = level === 'risk'
        ? '空间快用完了，新照片可能保存失败。先导出备份，再清理不需要的照片或模块数据。'
        : level === 'warn'
          ? '空间开始紧张，建议清理不再需要的照片，或导出备份后清空部分模块。'
          : '空间充足，可以放心添加照片。';

      return {
        supported: true, usage: usage, quota: quota, pct: pct,
        freeMB: freeMB, images: images,
        level: level, label: label, hint: hint
      };
    });
  }

  /* ---------------- 备份新鲜度 ---------------- */

  function totalRecords() {
    var names = global.Store.businessStores();
    return Promise.all(names.map(function (n) {
      return global.Store.count(n).catch(function () { return 0; });
    })).then(function (list) {
      return list.reduce(function (a, b) { return a + b; }, 0);
    });
  }

  function backup() {
    return Promise.all([
      global.Store.getMeta(K.lastAt, null),
      global.Store.getMeta(K.lastTotal, 0),
      global.Store.getMeta(K.reminder, DEFAULT_DAYS),
      totalRecords()
    ]).then(function (r) {
      var lastAt = r[0];
      var lastTotal = Number(r[1]) || 0;
      var days = Number(r[2]);
      if (isNaN(days)) days = DEFAULT_DAYS;
      var total = r[3];

      var elapsed = null;
      if (lastAt) {
        var t = new Date(lastAt);
        if (!isNaN(t.getTime())) {
          elapsed = UI.daysBetween(
            new Date(t.getFullYear(), t.getMonth(), t.getDate()),
            UI.todayLocal()
          );
        }
      }

      var added = Math.max(0, total - lastTotal);
      var never = !lastAt;
      var enabled = days > 0;

      // 没有任何数据时不打扰
      var level = 'ok';
      if (total > 0 && enabled) {
        if (never) level = 'warn';
        else if (elapsed !== null && elapsed >= days) level = added > 0 ? 'risk' : 'warn';
        else if (added >= 20) level = 'warn';
      }

      var text;
      if (!total) text = '还没有数据，暂时不用备份';
      else if (never) text = '还没有备份过，建议导出一份';
      else if (elapsed === 0) text = '今天已备份';
      else text = '上次备份在 ' + elapsed + ' 天前';

      return {
        lastAt: lastAt, elapsed: elapsed, total: total,
        lastTotal: lastTotal, added: added,
        reminderDays: days, enabled: enabled, never: never,
        level: level, text: text
      };
    });
  }

  /** 导出成功后调用，记录时间与当时的记录总数 */
  function markBackup() {
    return totalRecords().then(function (total) {
      return Promise.all([
        global.Store.setMeta(K.lastAt, new Date().toISOString()),
        global.Store.setMeta(K.lastTotal, total)
      ]).then(function () { return total; });
    });
  }

  function setReminderDays(days) {
    return global.Store.setMeta(K.reminder, Number(days) || 0);
  }

  function dismissToday() {
    return global.Store.setMeta(K.dismissed, UI.dateStr());
  }

  function isDismissed() {
    return global.Store.getMeta(K.dismissed, '').then(function (v) {
      return v === UI.dateStr();
    });
  }

  /* ---------------- 首页提醒条 ---------------- */

  /**
   * 汇总需要在首页展示的提醒。存储紧张优先于备份提醒。
   * 用户当天忽略后不再显示，但存储 risk 级别始终显示。
   */
  function notices() {
    return Promise.all([storage(), backup(), isDismissed()]).then(function (r) {
      var st = r[0];
      var bk = r[1];
      var dismissed = r[2];
      var out = [];

      if (st.level === 'risk') {
        out.push({
          key: 'storage', level: 'risk',
          title: '存储空间快用完了',
          desc: '已用 ' + st.pct.toFixed(0) + '%，新照片可能保存失败',
          action: '去处理'
        });
      } else if (st.level === 'warn' && !dismissed) {
        out.push({
          key: 'storage', level: 'warn',
          title: '存储空间开始紧张',
          desc: '已用 ' + st.pct.toFixed(0) + '%，建议清理或备份后瘦身',
          action: '查看'
        });
      }

      if (bk.level !== 'ok' && !dismissed) {
        out.push({
          key: 'backup', level: bk.level,
          title: bk.never ? '还没有备份过数据' : '距上次备份已 ' + bk.elapsed + ' 天',
          desc: bk.added > 0
            ? '期间新增 ' + bk.added + ' 条记录，导出一份更稳妥'
            : '数据只在这台设备上，导出一份更稳妥',
          action: '导出备份'
        });
      }

      return out;
    });
  }

  /** 渲染首页提醒条 HTML */
  function noticeHtml(list) {
    if (!list.length) return '';
    return '<div class="notice-list">' + list.map(function (n) {
      return '<div class="notice notice--' + n.level + '" data-notice="' + n.key + '">' +
        '<div class="notice-body">' +
          '<b>' + UI.esc(n.title) + '</b>' +
          '<span>' + UI.esc(n.desc) + '</span>' +
        '</div>' +
        '<button type="button" class="notice-act" data-go>' + UI.esc(n.action) + '</button>' +
        '<button type="button" class="notice-x" data-dismiss aria-label="今天不再提醒">' +
          UI.icon('close', 14) + '</button>' +
      '</div>';
    }).join('') + '</div>';
  }

  global.Health = {
    K: K,
    DEFAULT_DAYS: DEFAULT_DAYS,
    REMINDER_OPTIONS: REMINDER_OPTIONS,
    storage: storage,
    backup: backup,
    totalRecords: totalRecords,
    markBackup: markBackup,
    setReminderDays: setReminderDays,
    dismissToday: dismissToday,
    isDismissed: isDismissed,
    notices: notices,
    noticeHtml: noticeHtml
  };
})(window);
