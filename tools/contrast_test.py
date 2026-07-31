#!/usr/bin/env python3
"""全量对比度测试：徽章、状态色、按钮，浅色与深色两套主题都验。

状态色（ok/warn/danger）有两种用法：徽章文字色配同名 -bg 底，
以及实心按钮底色配 --surface 文字。两种用法都要达到 WCAG AA，
深色主题下这些色需要反向提亮，容易漏，因此单独成一套测试。

用法：.venv/bin/python tools/contrast_test.py
"""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import BASE_URL, CDP, launch_chrome, wait_debugger  # noqa: E402

PASS, FAIL = [], []

HELPER = """
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
function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function toRgb(v){
  var d = document.createElement('div');
  d.style.color = v;
  document.body.appendChild(d);
  var out = getComputedStyle(d).color;
  d.remove();
  return out;
}
function pairRatio(fg, bg){
  return ratio(toRgb(cssVar(fg)), toRgb(cssVar(bg)));
}
"""


def check(name: str, ok: bool, extra: str = "") -> None:
    (PASS if ok else FAIL).append(name)
    print(("  ✅ " if ok else "  ❌ ") + name + (f"  {extra}" if extra else ""))


# (前景变量, 背景变量, 说明, 下限)
VAR_PAIRS = [
    ("--ink", "--bg", "正文 / 页面底", 4.5),
    ("--ink-2", "--surface", "次级文字 / 卡片底", 4.5),
    ("--ink-3", "--surface", "辅助文字 / 卡片底", 3.0),
    ("--ink-muted", "--surface", "弱化文字 / 卡片底", 3.0),
    ("--ok", "--ok-bg", "成功徽章", 3.0),
    ("--warn", "--warn-bg", "警示徽章", 3.0),
    ("--danger", "--danger-bg", "危险徽章", 3.0),
    ("--accent-ink", "--accent-bg", "强调徽章", 3.0),
    ("--surface", "--ok", "成功实心按钮文字", 3.0),
    ("--surface", "--warn", "警示实心按钮文字", 3.0),
    ("--surface", "--danger", "危险实心按钮文字", 3.0),
    ("--surface", "--accent-ink", "主按钮文字", 4.5),
]


def run(cdp: CDP, theme: str) -> None:
    label = "浅色" if theme == "light" else "深色"
    print(f"\n▸ {label}主题 · CSS 变量组合")
    for fg, bg, desc, floor in VAR_PAIRS:
        val = cdp.eval(HELPER + f"return pairRatio('{fg}', '{bg}');")
        check(f"[{label}] {desc}", val >= floor, f"{val:.2f}:1（下限 {floor}）")

    print(f"\n▸ {label}主题 · 实际渲染元素")
    live = cdp.eval(HELPER + """
      var out = [];
      function push(name, node, floor){
        if (!node) return;
        var bgNode = node;
        var bg = getComputedStyle(bgNode).backgroundColor;
        while (bg === 'rgba(0, 0, 0, 0)' && bgNode.parentElement) {
          bgNode = bgNode.parentElement;
          bg = getComputedStyle(bgNode).backgroundColor;
        }
        out.push({name: name, floor: floor,
                  value: ratio(getComputedStyle(node).color, bg)});
      }
      push('首页问候语', document.querySelector('.greeting'), 4.5);
      push('卡片标题', document.querySelector('.tool-title'), 4.5);
      push('卡片描述', document.querySelector('.tool-desc'), 3.0);
      push('卡片统计', document.querySelector('.tool-meta'), 3.0);
      push('分区标签', document.querySelector('.section-label'), 3.0);
      push('页脚说明', document.querySelector('.page-foot'), 3.0);
      return out;
    """)
    for row in live:
        check(f"[{label}] {row['name']}", row["value"] >= row["floor"],
              f"{row['value']:.2f}:1（下限 {row['floor']}）")


def main() -> int:
    profile = tempfile.mkdtemp(prefix="wb-contrast-")
    chrome = launch_chrome(profile)
    cdp = None
    try:
        cdp = CDP(wait_debugger())
        cdp.attach()

        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页")
        run(cdp, "light")

        cdp.eval("localStorage.setItem('wb_theme','dark'); return true;")
        cdp.send("Page.reload", {"ignoreCache": False})
        cdp.wait_for(
            "getComputedStyle(document.body).backgroundColor === 'rgb(35, 33, 30)'",
            "深色生效")
        run(cdp, "dark")

        errs = [l for l in cdp.logs if "pageerror" in l]
        check("无 JS 报错", not errs, "; ".join(errs[:2]))
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


if __name__ == "__main__":
    sys.exit(main())
