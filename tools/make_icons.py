#!/usr/bin/env python3
"""生成 WorkBuddy 的 PWA 图标（莫兰迪配色，纯本地生成，无网络依赖）。

用法：python3 tools/make_icons.py
输出：icons/icon-192.png、icons/icon-512.png、icons/icon-maskable-512.png
"""
from pathlib import Path

from PIL import Image, ImageDraw

BG = (239, 234, 227)        # 米杏底
PLATE = (226, 210, 198)     # 莫兰迪陶土
INK = (110, 96, 84)         # 线条色
ICON_DIR = Path(__file__).resolve().parent.parent / "icons"


def rounded_plate(size: int, radius_ratio: float, inset_ratio: float) -> Image.Image:
    """生成带圆角底板的画布，4 倍超采样后缩小以获得平滑边缘。"""
    scale = 4
    big = size * scale
    img = Image.new("RGBA", (big, big), BG + (255,))
    draw = ImageDraw.Draw(img)

    inset = int(big * inset_ratio)
    radius = int(big * radius_ratio)
    draw.rounded_rectangle(
        [inset, inset, big - inset, big - inset],
        radius=radius,
        fill=PLATE + (255,),
    )

    # 衣架轮廓：一条挂钩 + 一根横杆，呼应“电子衣柜”
    cx = big // 2
    top = int(big * 0.32)
    bar_y = int(big * 0.60)
    half = int(big * 0.20)
    lw = max(2, int(big * 0.030))

    draw.arc(
        [cx - int(big * 0.055), top - int(big * 0.055),
         cx + int(big * 0.055), top + int(big * 0.055)],
        start=200, end=340, fill=INK + (255,), width=lw,
    )
    draw.line([cx, top + int(big * 0.045), cx - half + lw, bar_y],
              fill=INK + (255,), width=lw)
    draw.line([cx, top + int(big * 0.045), cx + half - lw, bar_y],
              fill=INK + (255,), width=lw)
    draw.line([cx - half, bar_y, cx + half, bar_y],
              fill=INK + (255,), width=lw)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    targets = [
        ("icon-192.png", 192, 0.22, 0.06),
        ("icon-512.png", 512, 0.22, 0.06),
        # maskable 需要更大安全边距，避免系统裁切掉主体
        ("icon-maskable-512.png", 512, 0.30, 0.16),
    ]

    for name, size, radius_ratio, inset_ratio in targets:
        img = rounded_plate(size, radius_ratio, inset_ratio)
        out = ICON_DIR / name
        img.save(out, format="PNG", optimize=True)
        print(f"已生成 {out.relative_to(ICON_DIR.parent)} ({out.stat().st_size} B)")


if __name__ == "__main__":
    main()
