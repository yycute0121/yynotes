#!/usr/bin/env python3
"""像素级视觉回归测试。

为什么需要它：getComputedStyle 只能反映 CSS 声明，无法发现
「有元素盖在页面上」这类问题。曾经因为带 hidden 属性的浮层被
display:grid 覆盖，整页被一层 92% 不透明遮罩盖住，而只查
computedStyle 的测试全部通过。此脚本改为对真实渲染像素取样。

用法：.venv/bin/python tools/visual_test.py
"""
from __future__ import annotations

import base64
import io
import shutil
import sys
import tempfile
from collections import Counter
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import BASE_URL, CDP, PORT, free_port, launch_chrome, wait_debugger  # noqa: E402

PASS, FAIL = [], []
CREAM = (239, 234, 227)  # #EFEAE3


def check(name: str, ok: bool, extra: str = "") -> None:
    (PASS if ok else FAIL).append(name)
    print(("  ✅ " if ok else "  ❌ ") + name + (f"  {extra}" if extra else ""))


def grab(cdp: CDP) -> Image.Image:
    data = cdp.send("Page.captureScreenshot", {"format": "png"})["data"]
    return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")


def dominant(img: Image.Image, box) -> tuple:
    return Counter(img.crop(box).getdata()).most_common(1)[0][0]


def near(a, b, tol=8) -> bool:
    return sum(abs(x - y) for x, y in zip(a, b)) <= tol


def hexs(rgb) -> str:
    return "#%02X%02X%02X" % tuple(rgb)


def main() -> int:
    if not free_port(PORT):
        print(f"端口 {PORT} 被占用")
        return 1

    profile = tempfile.mkdtemp(prefix="wb-visual-")
    chrome = launch_chrome(profile)
    cdp = None
    try:
        cdp = CDP(wait_debugger())
        cdp.attach()
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 414, "height": 896, "deviceScaleFactor": 1, "mobile": True,
        })

        print("▸ 首屏没有被任何浮层遮挡")
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页")
        img = grab(cdp)
        top = dominant(img, (0, 0, img.width, 12))
        check("实际渲染的背景就是奶油米杏", near(top, CREAM),
              f"{hexs(top)} 期望 {hexs(CREAM)}")

        # 全屏容器本身允许存在，但不能有可见背景、也不能拦截点击
        overlays = cdp.eval("""
          function alpha(css){
            var m = css.match(/rgba?\\(([^)]+)\\)/);
            if (!m) return 0;
            var p = m[1].split(',').map(Number);
            return p.length > 3 ? p[3] : 1;
          }
          var bad = [];
          ['#viewer-root', '#sheet-root', '#toast-root'].forEach(function(sel){
            var el = document.querySelector(sel);
            if (!el) return;
            var cs = getComputedStyle(el);
            var r = el.getBoundingClientRect();
            var covers = r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8;
            var rendered = cs.display !== 'none' && cs.visibility !== 'hidden' &&
                           Number(cs.opacity) > 0.01;
            var paints = alpha(cs.backgroundColor) > 0.01;
            var blocks = cs.pointerEvents !== 'none';
            if (covers && rendered && (paints || blocks)) {
              bad.push(sel + ' display=' + cs.display + ' bg=' + cs.backgroundColor +
                       ' pointer=' + cs.pointerEvents);
            }
          });
          return bad;
        """)
        check("空闲时没有会遮挡或拦截点击的全屏浮层", overlays == [], "; ".join(overlays))

        hidden_ok = cdp.eval("""
          var el = document.querySelector('#viewer-root');
          return {
            hasAttr: el.hasAttribute('hidden'),
            display: getComputedStyle(el).display
          };
        """)
        check("hidden 属性能真正隐藏元素",
              hidden_ok["hasAttr"] and hidden_ok["display"] == "none",
              f"hidden={hidden_ok['hasAttr']} display={hidden_ok['display']}")

        print("\n▸ 首页可点击（没有被遮罩拦截）")
        hit = cdp.eval("""
          var card = document.querySelector('.tool-card--wardrobe');
          var r = card.getBoundingClientRect();
          var el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
          return {
            tag: el ? el.tagName + '.' + (el.className || '') : 'null',
            inCard: !!(el && card.contains(el))
          };
        """)
        check("点击落在卡片上而非遮罩", hit["inCard"] is True, hit["tag"])

        print("\n▸ 文字对比度（实际渲染）")
        contrast = cdp.eval("""
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
          var card = document.querySelector('.tool-card--wardrobe');
          var cs = getComputedStyle(card).backgroundColor;
          var g = document.querySelector('.greeting');
          var bodyBg = getComputedStyle(document.body).backgroundColor;
          var worst = 99, worstSel = '';
          Array.from(document.querySelectorAll('.tool-card')).forEach(function(c){
            var bg = getComputedStyle(c).backgroundColor;
            ['.tool-title', '.tool-desc', '.tool-meta'].forEach(function(sel){
              var n = c.querySelector(sel);
              if (!n) return;
              var r = ratio(getComputedStyle(n).color, bg);
              if (r < worst) { worst = r; worstSel = c.querySelector('.tool-title').textContent + ' ' + sel; }
            });
          });
          return {
            greeting: ratio(getComputedStyle(g).color, bodyBg),
            title: ratio(getComputedStyle(card.querySelector('.tool-title')).color, cs),
            desc: ratio(getComputedStyle(card.querySelector('.tool-desc')).color, cs),
            worst: worst, worstSel: worstSel
          };
        """)
        check("问候语对比度达 AA（≥4.5）", contrast["greeting"] >= 4.5,
              f"{contrast['greeting']:.2f}:1")
        check("卡片标题对比度达 AA（≥4.5）", contrast["title"] >= 4.5,
              f"{contrast['title']:.2f}:1")
        check("卡片描述对比度达 AA 大字（≥3.0）", contrast["desc"] >= 3.0,
              f"{contrast['desc']:.2f}:1")
        check("四张卡片所有文字均不低于 3.0", contrast["worst"] >= 3.0,
              f"最低 {contrast['worst']:.2f}:1 于 {contrast['worstSel']}")

        print("\n▸ 抽屉打开时才出现遮罩，关闭后完全消失")
        cdp.goto(BASE_URL + "#/wardrobe/closet")
        cdp.wait_for("!!document.querySelector('.fab')", "悬浮按钮")
        before = dominant(grab(cdp), (0, 0, 414, 12))
        cdp.eval("document.querySelector('.fab').click(); return true;")
        cdp.wait_for("!!document.querySelector('.sheet-body [data-f]')", "抽屉打开")
        import time
        time.sleep(0.6)
        during = dominant(grab(cdp), (0, 0, 414, 12))
        check("抽屉打开时顶部出现遮罩", not near(during, before, 20),
              f"{hexs(before)} → {hexs(during)}")

        cdp.eval("UI.closeSheet(); return true;")
        time.sleep(0.7)
        after = dominant(grab(cdp), (0, 0, 414, 12))
        check("抽屉关闭后遮罩完全撤除", near(after, before, 10),
              f"{hexs(after)} 期望回到 {hexs(before)}")

        no_layer = cdp.eval("return document.querySelectorAll('.sheet-layer').length;")
        check("抽屉 DOM 被清理", no_layer == 0, f"残留 {no_layer} 层")

        print("\n▸ 图片查看器开合")
        opened = cdp.eval("""
          UI.viewer('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
          var el = document.querySelector('#viewer-root');
          return {hidden: el.hidden, display: getComputedStyle(el).display};
        """)
        check("查看器打开后可见", opened["hidden"] is False and opened["display"] == "grid",
              f"display={opened['display']}")

        cdp.eval("document.querySelector('.viewer-close').click(); return true;")
        time.sleep(0.4)
        closed_px = dominant(grab(cdp), (0, 0, 414, 12))
        check("查看器关闭后页面恢复", near(closed_px, before, 10), hexs(closed_px))

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
