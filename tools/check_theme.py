#!/usr/bin/env python3
"""验证在系统深色偏好下，应用仍保持奶油浅色主题，且手动切换可用。"""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import BASE_URL, CDP, launch_chrome, wait_debugger  # noqa: E402

PROBE = """
return {
  systemDark: matchMedia('(prefers-color-scheme: dark)').matches,
  attr: document.documentElement.getAttribute('data-theme'),
  bodyBg: getComputedStyle(document.body).backgroundColor,
  cardBg: getComputedStyle(document.querySelector('.tool-card--wardrobe')).backgroundColor,
  title: getComputedStyle(document.querySelector('.tool-title')).color,
  desc: getComputedStyle(document.querySelector('.tool-desc')).color
};
"""

LIGHT_BG = "rgb(239, 234, 227)"
DARK_BG = "rgb(35, 33, 30)"


def main() -> int:
    profile = tempfile.mkdtemp(prefix="wb-theme-")
    chrome = launch_chrome(profile)
    cdp = None
    ok = True
    try:
        cdp = CDP(wait_debugger())
        cdp.attach()
        # 模拟系统深色偏好，验证应用不跟随
        cdp.send("Emulation.setEmulatedMedia", {
            "media": "screen",
            "features": [{"name": "prefers-color-scheme", "value": "dark"}],
        })
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页")

        r = cdp.eval(PROBE)
        print("▸ 系统深色偏好下的实际取色")
        for k, v in r.items():
            print(f"    {k:11s} = {v}")
        # 三态主题下默认锁定 light，data-theme 显式为 "light"
        light_ok = r["bodyBg"] == LIGHT_BG and r["attr"] in (None, "light")
        ok &= light_ok and r["systemDark"] is True
        print(("  ✅ " if light_ok else "  ❌ ") + "系统深色下仍保持奶油浅色")

        print("\n▸ 手动切换深色")
        cdp.goto(BASE_URL + "#/settings")
        cdp.wait_for("!!document.querySelector('[data-theme-toggle]')", "设置页开关")
        cdp.eval("""
          var t = document.querySelector('[data-theme-toggle]');
          t.checked = true;
          t.dispatchEvent(new Event('change', {bubbles:true}));
          return true;
        """)
        dark_bg = cdp.wait_for(
            "getComputedStyle(document.body).backgroundColor === '%s'" % DARK_BG,
            "切换到深色")
        ok &= bool(dark_bg)
        print("  ✅ 手动开启深色生效")

        # 对比度要在首页量（卡片是首页元素）
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.tool-card--wardrobe')", "首页卡片")
        contrast = cdp.eval("""
          function lum(css){
            var n = css.match(/[\\d.]+/g).map(Number);
            var f = n.slice(0,3).map(function(v){
              v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
            });
            return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2];
          }
          function ratio(a,b){
            var l1=lum(a), l2=lum(b);
            var hi=Math.max(l1,l2), lo=Math.min(l1,l2);
            return (hi+0.05)/(lo+0.05);
          }
          var card = document.querySelector('.tool-card--wardrobe');
          var cs = getComputedStyle(card).backgroundColor;
          return {
            title: ratio(getComputedStyle(card.querySelector('.tool-title')).color, cs),
            desc: ratio(getComputedStyle(card.querySelector('.tool-desc')).color, cs)
          };
        """)
        print(f"    深色下卡片标题对比度 {contrast['title']:.2f}:1，"
              f"描述 {contrast['desc']:.2f}:1")
        c_ok = contrast["title"] >= 4.5 and contrast["desc"] >= 3.0
        ok &= c_ok
        print(("  ✅ " if c_ok else "  ❌ ") + "深色文字对比度达标")

        print("\n▸ 刷新后保持用户选择")
        cdp.send("Page.reload", {"ignoreCache": False})
        cdp.wait_for("!!document.querySelector('.greeting')", "刷新首页")
        persisted = cdp.eval("return getComputedStyle(document.body).backgroundColor;")
        p_ok = persisted == DARK_BG
        ok &= p_ok
        print(("  ✅ " if p_ok else "  ❌ ") + f"偏好已持久化（{persisted}）")

        print("\n▸ 切回浅色")
        cdp.goto(BASE_URL + "#/settings")
        cdp.wait_for("!!document.querySelector('[data-theme-toggle]')", "设置页")
        cdp.eval("""
          var t = document.querySelector('[data-theme-toggle]');
          t.checked = false;
          t.dispatchEvent(new Event('change', {bubbles:true}));
          return true;
        """)
        back = cdp.wait_for(
            "getComputedStyle(document.body).backgroundColor === '%s'" % LIGHT_BG,
            "切回浅色")
        ok &= bool(back)
        print("  ✅ 可切回奶油浅色")

        errs = [l for l in cdp.logs if "pageerror" in l]
        if errs:
            ok = False
            print("\n页面报错：" + errs[0])
    finally:
        if cdp:
            cdp.close()
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except Exception:
            chrome.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print("\n" + "=" * 46)
    print("主题核对：" + ("通过" if ok else "存在问题"))
    print("=" * 46)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
