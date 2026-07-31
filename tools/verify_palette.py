#!/usr/bin/env python3
"""核对莫兰迪配色是否落地。

读取 tools/shots/meta.json（页面真实计算样式）做断言，
并用 PIL 抽查截图主色，确认渲染结果与样式一致。

判定口径：
- 页面背景：高明度、低饱和、暖色相（浅米杏）
- 四张卡片：四种不同底色，饱和度均不超过 22%（莫兰迪特征）
- 卡片圆角不小于 18px，且带柔和阴影
"""
from __future__ import annotations

import colorsys
import json
import re
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

SHOTS = Path(__file__).resolve().parent / "shots"
PASS, FAIL = [], []


def check(name: str, ok: bool, extra: str = "") -> None:
    (PASS if ok else FAIL).append(name)
    print(("  ✅ " if ok else "  ❌ ") + name + (f"  {extra}" if extra else ""))


def parse_rgb(css: str):
    nums = [float(n) for n in re.findall(r"[\d.]+", css)]
    return tuple(int(round(n)) for n in nums[:3])


def hsv(rgb):
    h, s, v = colorsys.rgb_to_hsv(*[c / 255 for c in rgb])
    return h * 360, s * 100, v * 100


def hexs(rgb):
    return "#%02X%02X%02X" % tuple(rgb)


def main() -> int:
    meta_path = SHOTS / "meta.json"
    if not meta_path.exists():
        print("缺少 meta.json，请先运行 tools/shoot.py")
        return 1
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    print("▸ 页面基调（浅色模式）")
    check("截图确实运行在浅色模式", meta.get("dark") is False,
          f"prefers-color-scheme dark = {meta.get('dark')}")
    bg = parse_rgb(meta["pageBg"])
    bh, bs, bv = hsv(bg)
    check("背景为浅米杏、低饱和", bv > 88 and bs < 12 and 20 <= bh <= 60,
          f"{hexs(bg)} 色相{bh:.0f}° 饱和{bs:.1f}% 明度{bv:.1f}%")

    ink = parse_rgb(meta["ink"])
    _, _, iv = hsv(ink)
    check("主文字为深棕灰，非纯黑", iv < 45 and ink != (0, 0, 0),
          f"{hexs(ink)} 明度{iv:.1f}%")

    print("\n▸ 四张功能卡片")
    cards = meta["cards"]
    check("卡片数量为 4", len(cards) == 4, f"实际 {len(cards)} 张")

    sats, colors = [], []
    for c in cards:
        rgb = parse_rgb(c["bg"])
        ch, cs, cv = hsv(rgb)
        sats.append(cs)
        colors.append(hexs(rgb))
        print(f"     {c['title']:8s} {hexs(rgb)}  "
              f"色相{ch:>3.0f}° 饱和{cs:>4.1f}% 明度{cv:>5.1f}%  "
              f"{c['w']}x{c['h']} 圆角{c['radius']}")

    check("卡片均为低饱和莫兰迪色（≤22%）", all(s <= 22 for s in sats),
          f"最高饱和 {max(sats):.1f}%")
    check("四张卡片底色互不相同", len(set(colors)) == 4, " / ".join(colors))
    check("卡片明度均偏高，观感柔和",
          all(hsv(parse_rgb(c["bg"]))[2] > 70 for c in cards))

    radii = [float(re.findall(r"[\d.]+", c["radius"])[0]) for c in cards]
    check("卡片使用大圆角（≥18px）", all(r >= 18 for r in radii), f"{radii[0]:.0f}px")
    check("卡片带柔和阴影", all("rgba" in c["shadow"] for c in cards))
    check("卡片竖向排列且等宽",
          len({c["w"] for c in cards}) == 1, f"宽度 {cards[0]['w']}px")

    print("\n▸ 文案与布局")
    check("问候语字号突出（≥22px）",
          float(re.findall(r"[\d.]+", meta["greetSize"])[0]) >= 22, meta["greetSize"])
    check("底部标注数据仅存本机", "仅保存在本机" in meta["footer"])
    check("按移动端视口渲染", meta["viewport"]["w"] <= 430,
          f"{meta['viewport']['w']}x{meta['viewport']['h']}")

    print("\n▸ 截图渲染")
    expected = {
        "01-home": "首页",
        "02-closet": "我的衣橱",
        "03-wishlist": "想买清单",
        "04-avatars": "数字人物",
        "05-canvas": "画布编辑器",
        "06-form-sheet": "录入抽屉",
        "07-devices": "电子物品档案",
        "08-inventory": "生活用品库存",
        "09-project": "项目详情",
        "10-notes": "随手一记",
        "11-settings": "数据与存储",
        "12-home-notice": "首页备份提醒",
        "13-home-dark": "深色模式首页",
    }
    for name, label in expected.items():
        p = SHOTS / f"{name}.png"
        ok = p.exists() and p.stat().st_size > 10000
        size = f"{Image.open(p).size[0]}x{Image.open(p).size[1]}" if ok else "缺失"
        check(f"{label} 截图正常", ok, size)

    # 抽查首页截图顶部主色，确认与计算样式一致
    home = Image.open(SHOTS / "01-home.png").convert("RGB")
    top = home.crop((0, 0, home.width, int(home.height * 0.015)))
    dom = Counter(top.getdata()).most_common(1)[0][0]
    diff = sum(abs(a - b) for a, b in zip(dom, bg))
    check("截图实际背景与样式一致", diff <= 12, f"截图 {hexs(dom)} vs 样式 {hexs(bg)}")

    dark = Image.open(SHOTS / "13-home-dark.png").convert("RGB")
    dtop = Counter(dark.crop((0, 0, dark.width, int(dark.height * 0.015))).getdata()).most_common(1)[0][0]
    check("深色模式确实变暗", hsv(dtop)[2] < 30, f"{hexs(dtop)} 明度{hsv(dtop)[2]:.1f}%")

    print("\n" + "=" * 52)
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    for f in FAIL:
        print("  · " + f)
    print("=" * 52)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
