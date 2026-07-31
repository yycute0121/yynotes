#!/usr/bin/env python3
"""核对提醒条与用量标签在两种分级下的文字对比度。"""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import BASE_URL, CDP, launch_chrome, wait_debugger  # noqa: E402

PROBE = """
function lum(css){
  var n = css.match(/[\\d.]+/g).map(Number);
  var f = n.slice(0,3).map(function(v){
    v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
  });
  return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2];
}
function ratio(a,b){
  var l1=lum(a), l2=lum(b), hi=Math.max(l1,l2), lo=Math.min(l1,l2);
  return (hi+0.05)/(lo+0.05);
}
function probe(sel){
  var n = document.querySelector(sel);
  if (!n) return null;
  var bg = getComputedStyle(n.closest('.notice') || n).backgroundColor;
  return ratio(getComputedStyle(n).color, bg);
}
"""


def main() -> int:
    profile = tempfile.mkdtemp(prefix="wb-notice-")
    chrome = launch_chrome(profile)
    cdp = None
    ok = True
    try:
        cdp = CDP(wait_debugger())
        cdp.attach()
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!window.Health", "health 加载")

        for level, days in [("warn", 20), ("risk", 40)]:
            cdp.eval("""
              var d = new Date(); d.setDate(d.getDate() - %d);
              await Store.put(Store.S.notes, {id:'cn1', title:'x', body:'y',
                images:[], createdAt:Date.now(), updatedAt:Date.now()});
              await Store.setMeta(Health.K.reminder, 14);
              await Store.setMeta(Health.K.lastAt, d.toISOString());
              await Store.setMeta(Health.K.lastTotal, %d);
              await Store.setMeta(Health.K.dismissed, '');
              return true;
            """ % (days, 0 if level == "risk" else 1))
            # 同一个 hash 重复导航不会触发重渲染，这里强制重载
            cdp.send("Page.reload", {"ignoreCache": False})
            cdp.wait_for("!!document.querySelector('[data-notice]')", "提醒条")

            r = cdp.eval(PROBE + """
              var n = document.querySelector('[data-notice]');
              return {
                cls: n.className,
                title: probe('[data-notice] b'),
                desc: probe('[data-notice] span'),
                act: (function(){
                  var b = document.querySelector('[data-notice] [data-go]');
                  return ratio(getComputedStyle(b).color,
                               getComputedStyle(b).backgroundColor);
                })()
              };
            """)
            print(f"▸ {level} 级提醒条（{r['cls'].split()[-1]}）")
            for key, label, floor in [("title", "标题", 4.5),
                                      ("desc", "说明", 3.0),
                                      ("act", "按钮", 3.0)]:
                val = r[key]
                good = val >= floor
                ok &= good
                print(("  ✅ " if good else "  ❌ ") +
                      f"{label}对比度 {val:.2f}:1（下限 {floor}）")

        cdp.goto(BASE_URL + "#/settings")
        cdp.wait_for("!!document.querySelector('.usage-tag')", "用量标签")
        tag = cdp.eval(PROBE + """
          var t = document.querySelector('.usage-tag');
          return ratio(getComputedStyle(t).color, getComputedStyle(t).backgroundColor);
        """)
        good = tag >= 3.0
        ok &= good
        print("\n▸ 用量标签")
        print(("  ✅ " if good else "  ❌ ") + f"标签对比度 {tag:.2f}:1（下限 3.0）")

    finally:
        if cdp:
            cdp.close()
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except Exception:
            chrome.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print("\n" + "=" * 44)
    print("提醒条可读性：" + ("通过" if ok else "存在问题"))
    print("=" * 44)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
