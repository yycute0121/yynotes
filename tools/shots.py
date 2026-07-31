#!/usr/bin/env python3
"""生成各页面截图，用于人工核对视觉效果（莫兰迪配色、留白、卡片圆角）。

用法：.venv/bin/python tools/shots.py
输出：tools/shots/*.png
"""
from __future__ import annotations

import base64
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from smoke_test import (  # noqa: E402
    BASE_URL, CDP, PORT, free_port, launch_chrome, wait_debugger,
)

OUT = Path(__file__).resolve().parent / "shots"
SCHEME = sys.argv[1] if len(sys.argv) > 1 else "light"

SEED = """
function mk(w,h,c1,c2){
  var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
  var x=cv.getContext('2d');
  x.fillStyle='#ffffff'; x.fillRect(0,0,w,h);
  var g=x.createLinearGradient(0,0,w,h);
  g.addColorStop(0,c1); g.addColorStop(1,c2);
  x.fillStyle=g;
  x.beginPath();
  x.moveTo(w*0.28,h*0.16); x.lineTo(w*0.72,h*0.16);
  x.lineTo(w*0.80,h*0.86); x.lineTo(w*0.20,h*0.86);
  x.closePath(); x.fill();
  return new Promise(function(r){ cv.toBlob(function(b){ r(new File([b],'s.png',{type:'image/png'})); },'image/png'); });
}
async function addCloth(name,cat,season,price,c1,c2){
  var f=await mk(700,900,c1,c2);
  var src=await Img.decode(f);
  var img=await Img.persist(src,{alpha:false});
  Img.release(src);
  await Store.put(Store.S.clothes,{id:Store.uid('cloth'),name:name,category:cat,season:season,
    color:'',brand:'',price:price,buyDate:'2026-04-12',note:'',fullId:img.fullId,
    thumbId:img.thumbId,w:img.w,h:img.h,createdAt:Date.now(),updatedAt:Date.now()});
  return img;
}
await addCloth('米色针织开衫','上衣','秋',399,'#d8cfc2','#b8a894');
await addCloth('黑色阔腿裤','下装','四季',259,'#8b8880','#5d5a54');
await addCloth('燕麦色卫衣','上衣','春',329,'#ded5c6','#c3b6a2');
await addCloth('雾霾蓝衬衫','上衣','夏',219,'#cbd3d7','#9aa9b0');
await addCloth('羊毛长大衣','外套','冬',1299,'#cfc7bb','#a1968a');
await addCloth('豆沙色乐福鞋','鞋子','四季',699,'#e0cfcb','#b89a94');

await Store.put(Store.S.wishlist,{id:Store.uid('wish'),name:'羊绒围巾',category:'配饰',
  price:520,link:'https://example.com/1',status:'hesitate',note:'等降价',
  fullId:null,thumbId:null,createdAt:Date.now(),updatedAt:Date.now()});
await Store.put(Store.S.wishlist,{id:Store.uid('wish'),name:'编织托特包',category:'包包',
  price:880,link:'',status:'want',note:'通勤用',fullId:null,thumbId:null,
  createdAt:Date.now(),updatedAt:Date.now()});
await Store.put(Store.S.wishlist,{id:Store.uid('wish'),name:'亚麻半裙',category:'下装',
  price:340,link:'',status:'bought',note:'',fullId:null,thumbId:null,
  createdAt:Date.now(),updatedAt:Date.now()});

var af=await mk(700,1400,'#d5cdc2','#9f958a');
var asrc=await Img.decode(af);
var aimg=await Img.persist(asrc,{alpha:false});
Img.release(asrc);
await Store.put(Store.S.avatars,{id:Store.uid('avatar'),name:'人物素材',fullId:aimg.fullId,
  thumbId:aimg.thumbId,w:aimg.w,h:aimg.h,isDefault:true,createdAt:Date.now()});
return true;
"""


def shoot(cdp: CDP, name: str, full: bool = True) -> None:
    params = {"format": "png", "captureBeyondViewport": bool(full)}
    if full:
        m = cdp.send("Page.getLayoutMetrics")
        css = m.get("cssContentSize") or m["contentSize"]
        params["clip"] = {
            "x": 0, "y": 0,
            "width": css["width"],
            "height": min(css["height"], 2600),
            "scale": 1,
        }
    data = cdp.send("Page.captureScreenshot", params)["data"]
    suffix = "" if SCHEME == "light" else "_dark"
    path = OUT / f"{name}{suffix}.png"
    path.write_bytes(base64.b64decode(data))
    print(f"  {path.relative_to(OUT.parent.parent)}  ({path.stat().st_size // 1024} KB)")


def main() -> int:
    if not free_port(PORT):
        print(f"端口 {PORT} 被占用")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    profile = tempfile.mkdtemp(prefix="wb-shots-")
    chrome = launch_chrome(profile)
    cdp = None
    try:
        cdp = CDP(wait_debugger())
        cdp.attach()
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 414, "height": 896, "deviceScaleFactor": 2, "mobile": True,
        })
        cdp.send("Emulation.setEmulatedMedia", {
            "features": [{"name": "prefers-color-scheme", "value": SCHEME}],
        })
        print(f"配色模式：{SCHEME}")

        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页")
        cdp.eval(SEED)

        pages = [
            ("01_home", "#/", ".tool-card--wardrobe .tool-meta"),
            ("02_closet", "#/wardrobe/closet", "[data-panel] .grid"),
            ("03_wishlist", "#/wardrobe/wishlist", "[data-panel] .row-card"),
            ("04_avatars", "#/wardrobe/avatars", "[data-panel] .item-card"),
            ("05_outfits_empty", "#/wardrobe/outfits", "[data-panel] .empty"),
        ]
        print("\n生成截图：")
        for name, hash_url, ready in pages:
            cdp.goto(BASE_URL + hash_url)
            cdp.wait_for(f"!!document.querySelector('{ready}')", name)
            time.sleep(1.4)
            shoot(cdp, name)

        # 画布编辑器：放几个素材再截图
        cdp.eval("document.querySelector('[data-new]').click(); return true;")
        cdp.wait_for("document.querySelectorAll('[data-tray-cloth] [data-ref]').length>0", "托盘")
        cdp.eval("""
          document.querySelector('[data-tray-avatar] [data-ref]').click();
          var it = document.querySelectorAll('[data-tray-cloth] [data-ref]');
          it[0].click(); it[1].click();
          return true;
        """)
        cdp.wait_for("document.querySelectorAll('.stage-node').length===3", "节点")
        time.sleep(1.6)
        shoot(cdp, "06_canvas")

        # 表单抽屉
        cdp.goto(BASE_URL + "#/wardrobe/closet")
        cdp.wait_for("!!document.querySelector('.fab')", "FAB")
        cdp.eval("document.querySelector('.fab').click(); return true;")
        cdp.wait_for("!!document.querySelector('.sheet-body .form')", "表单抽屉")
        time.sleep(1.0)
        shoot(cdp, "07_form_sheet", full=False)

        # 数据与存储
        cdp.eval("UI.closeSheet(true); return true;")
        cdp.goto(BASE_URL + "#/settings")
        cdp.wait_for("!!document.querySelector('.usage')", "存储页")
        time.sleep(1.0)
        shoot(cdp, "08_settings")

    finally:
        if cdp:
            cdp.close()
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except Exception:
            chrome.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print(f"\n截图目录：{OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
