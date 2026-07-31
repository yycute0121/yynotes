#!/usr/bin/env python3
"""存储用量预警与备份提醒测试。

用量分级依赖真实配额，无法在浏览器里随意伪造，因此对
Store.estimate 做临时替换来覆盖各档阈值；备份提醒则通过
直接写 meta 里的时间戳来模拟「N 天前备份过」。

用法：.venv/bin/python tools/health_test.py
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import (  # noqa: E402
    BASE_URL, CDP, FAIL, PASS, PORT, check, free_port, launch_chrome, wait_debugger,
)

# 用固定配额替换 estimate，逐档验证分级
FAKE = """
function fakeQuota(usedPct, quotaMB){
  var quota = quotaMB * 1024 * 1024;
  Store.estimate = function(){
    return Promise.resolve({usage: Math.round(quota * usedPct), quota: quota});
  };
}
"""

SEED = """
function iso(off){
  var d = new Date(); d.setDate(d.getDate()+off);
  var p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
async function seed(n){
  for (var i=0;i<n;i++){
    await Store.put(Store.S.notes, {id:'sn'+i, title:'笔记'+i, body:'内容',
      images:[], createdAt:Date.now()-i, updatedAt:Date.now()});
  }
  return await Store.count(Store.S.notes);
}
function daysAgo(n){
  var d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
"""


def main() -> int:
    if not free_port(PORT):
        print(f"端口 {PORT} 被占用")
        return 1

    profile = tempfile.mkdtemp(prefix="wb-health-")
    chrome = launch_chrome(profile)
    cdp = None
    try:
        cdp = CDP(wait_debugger())
        cdp.attach()
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页")
        cdp.wait_for("!!window.Health", "health 模块加载")

        print("▸ 存储用量分级")
        cases = [
            (0.20, 4096, "ok", "存储充足"),
            (0.70, 4096, "warn", "存储偏高"),
            (0.90, 4096, "risk", "存储紧张"),
        ]
        for pct, quota_mb, want_level, want_label in cases:
            got = cdp.eval(FAKE + f"""
              fakeQuota({pct}, {quota_mb});
              var st = await Health.storage();
              return {{level: st.level, label: st.label, pct: st.pct, hint: st.hint}};
            """)
            check(f"用量 {int(pct*100)}% 判为 {want_label}",
                  got["level"] == want_level and got["label"] == want_label,
                  f"level={got['level']} pct={got['pct']:.0f}%")

        # 剩余绝对空间偏小也要预警，即便百分比不高
        small = cdp.eval(FAKE + """
          fakeQuota(0.30, 60);
          var st = await Health.storage();
          return {level: st.level, freeMB: st.freeMB, pct: st.pct};
        """)
        check("配额很小时按剩余空间预警",
              small["level"] in ("warn", "risk"),
              f"剩余 {small['freeMB']:.0f}MB 时 level={small['level']}")

        hints = cdp.eval(FAKE + """
          fakeQuota(0.92, 4096);
          var risk = await Health.storage();
          fakeQuota(0.2, 4096);
          var ok = await Health.storage();
          return {risk: risk.hint, ok: ok.hint};
        """)
        check("紧张时给出可执行建议",
              "备份" in hints["risk"] and "清理" in hints["risk"], hints["risk"][:28])

        # 先造几条数据：没有数据时不会提示备份，无法验证文案
        cdp.eval(SEED + "await seed(5); return true;")

        print("\n▸ 设置页用量展示")
        cdp.goto(BASE_URL + "#/settings")
        cdp.wait_for("!!document.querySelector('.usage-tag')", "用量卡片")
        usage = cdp.eval("""
          var tag = document.querySelector('.usage-tag');
          var bar = document.querySelector('.usage-bar i');
          return {
            tag: tag.textContent.trim(),
            level: tag.dataset.level,
            barLevel: bar.dataset.level,
            width: bar.style.width,
            hint: (document.querySelector('.usage-hint')||{}).textContent || ''
          };
        """)
        check("用量卡片显示分级标签与百分比",
              "%" in usage["tag"] and usage["level"] in ("ok", "warn", "risk"),
              usage["tag"])
        check("进度条按分级着色", usage["barLevel"] == usage["level"],
              f"bar={usage['barLevel']} tag={usage['level']}")
        check("显示处置建议", len(usage["hint"]) > 8, usage["hint"][:26])

        print("\n▸ 备份状态与提醒周期")
        state = cdp.eval("""
          var bk = await Health.backup();
          var box = document.querySelector('.backup-state b');
          return {never: bk.never, days: bk.reminderDays, text: bk.text,
                  shown: box ? box.textContent : ''};
        """)
        check("默认提醒周期为 14 天", state["days"] == 14, f"{state['days']} 天")
        check("从未备份时如实显示", state["never"] is True and "还没有备份" in state["shown"],
              state["shown"])

        opts = cdp.eval("""
          return Array.from(document.querySelectorAll('[data-chips="reminder"] .chip'))
            .map(function(c){ return {v: c.dataset.v, on: c.getAttribute('aria-pressed')}; });
        """)
        check("提供 7/14/30/关闭 四个选项",
              [o["v"] for o in opts] == ["7", "14", "30", "0"], str([o["v"] for o in opts]))

        cdp.eval("""
          var chips = Array.from(document.querySelectorAll('[data-chips="reminder"] .chip'));
          chips.filter(function(c){return c.dataset.v==='7'})[0].click();
          return true;
        """)
        time.sleep(0.7)
        changed = cdp.eval("return (await Health.backup()).reminderDays;")
        check("切换提醒周期可持久化", changed == 7, f"{changed} 天")

        print("\n▸ 备份提醒触发条件")

        never = cdp.eval("""
          await Store.setMeta(Health.K.reminder, 14);
          await Store.setMeta(Health.K.lastAt, null);
          await Store.setMeta(Health.K.lastTotal, 0);
          await Store.setMeta(Health.K.dismissed, '');
          var bk = await Health.backup();
          var ns = await Health.notices();
          return {level: bk.level, keys: ns.map(function(n){return n.key;}),
                  titles: ns.map(function(n){return n.title;})};
        """)
        check("有数据且从未备份时提醒", "backup" in never["keys"], str(never["titles"]))

        fresh = cdp.eval(SEED + """
          await Health.markBackup();
          var bk = await Health.backup();
          var ns = await Health.notices();
          return {level: bk.level, elapsed: bk.elapsed, added: bk.added,
                  keys: ns.map(function(n){return n.key;})};
        """)
        check("刚备份完不再提醒",
              fresh["level"] == "ok" and "backup" not in fresh["keys"],
              f"elapsed={fresh['elapsed']} added={fresh['added']}")

        stale = cdp.eval(SEED + """
          await Store.setMeta(Health.K.lastAt, daysAgo(20));
          var bk = await Health.backup();
          var ns = await Health.notices();
          return {level: bk.level, elapsed: bk.elapsed, text: bk.text,
                  keys: ns.map(function(n){return n.key;})};
        """)
        check("超过提醒周期后触发提醒",
              stale["level"] != "ok" and "backup" in stale["keys"],
              f"{stale['text']} level={stale['level']}")

        dirty = cdp.eval(SEED + """
          await Store.setMeta(Health.K.lastAt, daysAgo(20));
          await seed(30);
          var bk = await Health.backup();
          var ns = await Health.notices();
          var n = ns.filter(function(x){return x.key==='backup'})[0];
          return {level: bk.level, added: bk.added, desc: n ? n.desc : ''};
        """)
        check("超期且有新增记录时升为高优先",
              dirty["level"] == "risk" and "新增" in dirty["desc"],
              f"新增 {dirty['added']} 条 · {dirty['desc']}")

        off = cdp.eval("""
          await Health.setReminderDays(0);
          var bk = await Health.backup();
          var ns = await Health.notices();
          return {level: bk.level, keys: ns.map(function(n){return n.key;})};
        """)
        check("关闭提醒后不再打扰",
              off["level"] == "ok" and "backup" not in off["keys"], str(off["keys"]))

        empty = cdp.eval("""
          await Health.setReminderDays(14);
          await Store.purgeStore(Store.S.notes);
          await Store.setMeta(Health.K.lastAt, null);
          await Store.setMeta(Health.K.lastTotal, 0);
          var bk = await Health.backup();
          return {level: bk.level, total: bk.total, text: bk.text};
        """)
        check("没有任何数据时不提醒备份",
              empty["level"] == "ok" and empty["total"] == 0, empty["text"])

        print("\n▸ 首页提醒条交互")
        cdp.eval(SEED + """
          await seed(8);
          await Store.setMeta(Health.K.reminder, 14);
          await Store.setMeta(Health.K.lastAt, daysAgo(30));
          await Store.setMeta(Health.K.lastTotal, 0);
          await Store.setMeta(Health.K.dismissed, '');
          return true;
        """)
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('[data-notice]')", "提醒条出现")
        notice = cdp.eval("""
          var n = document.querySelector('[data-notice="backup"]');
          return {
            exists: !!n,
            level: n ? n.className : '',
            title: n ? n.querySelector('b').textContent : '',
            action: n ? n.querySelector('[data-go]').textContent : ''
          };
        """)
        check("首页出现备份提醒条", notice["exists"] is True, notice["title"])
        check("提醒条带操作按钮", notice["action"] == "导出备份", notice["action"])

        cdp.eval("document.querySelector('[data-notice] [data-go]').click(); return true;")
        cdp.wait_for("!!document.querySelector('[data-export]')", "跳到设置页")
        check("点击操作跳转到数据与存储", True, location_hash(cdp))

        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('[data-notice]')", "提醒条再次出现")
        cdp.eval("document.querySelector('[data-notice] [data-dismiss]').click(); return true;")
        time.sleep(0.8)
        gone = cdp.eval("return document.querySelectorAll('[data-notice]').length;")
        check("忽略后当前页面移除提醒", gone == 0, f"剩 {gone} 条")

        cdp.goto(BASE_URL + "#/settings")
        cdp.goto(BASE_URL + "#/")
        time.sleep(1.0)
        still = cdp.eval("return document.querySelectorAll('[data-notice]').length;")
        check("当天忽略后重新进入也不再提醒", still == 0, f"剩 {still} 条")

        print("\n▸ 高危用量始终提示")
        risk = cdp.eval(FAKE + """
          fakeQuota(0.93, 4096);
          var ns = await Health.notices();
          return ns.map(function(n){return {key:n.key, level:n.level};});
        """)
        check("存储紧张即使已忽略也会提示",
              any(n["key"] == "storage" and n["level"] == "risk" for n in risk),
              str(risk))

        print("\n▸ 导出后提醒复位")
        reset = cdp.eval(SEED + """
          await seed(6);
          await Store.setMeta(Health.K.dismissed, '');
          await Store.setMeta(Health.K.lastAt, daysAgo(40));
          var before = (await Health.backup()).level;
          await Health.markBackup();
          var after = await Health.backup();
          return {before: before, after: after.level, elapsed: after.elapsed,
                  added: after.added};
        """)
        check("markBackup 后提醒复位",
              reset["before"] != "ok" and reset["after"] == "ok" and
              reset["elapsed"] == 0 and reset["added"] == 0,
              f"{reset['before']} → {reset['after']}")

        errs = [l for l in cdp.logs if "pageerror" in l]
        check("运行期无 JS 报错", not errs, "; ".join(errs[:3]))

    finally:
        if cdp:
            cdp.close()
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except Exception:
            chrome.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print("\n" + "=" * 52)
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    for f in FAIL:
        print("  · " + f)
    print("=" * 52)
    return 1 if FAIL else 0


def location_hash(cdp: CDP) -> str:
    return cdp.eval("return location.hash;")


if __name__ == "__main__":
    sys.exit(main())
