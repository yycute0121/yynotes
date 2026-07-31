#!/usr/bin/env python3
"""离线与内存压力测试。

1. 断网（CDP Network.emulateNetworkConditions offline）后重新加载，
   验证应用仍能启动、读取本地数据、进入搭配画布。
2. 连续导入大尺寸图片，验证落库体积可控、ObjectURL 不泄漏。

用法：.venv/bin/python tools/offline_test.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from smoke_test import (  # noqa: E402
    BASE_URL, CDP, check, FAIL, PASS, free_port, launch_chrome, wait_debugger, PORT,
)

BIG_IMAGE = """
function bigFile(w, h, name){
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  var x = c.getContext('2d');
  var g = x.createLinearGradient(0,0,w,h);
  g.addColorStop(0,'#cbd3d7'); g.addColorStop(1,'#8d7f6e');
  x.fillStyle = g; x.fillRect(0,0,w,h);
  for (var i=0;i<400;i++){
    x.fillStyle = 'rgba('+(i%255)+',120,'+(255-i%255)+',0.5)';
    x.fillRect((i*37)%w, (i*53)%h, 60, 60);
  }
  return new Promise(function(res){
    c.toBlob(function(b){ res(new File([b], name, {type:'image/png'})); }, 'image/png');
  });
}
"""


def main() -> int:
    if not free_port(PORT):
        print(f"端口 {PORT} 被占用")
        return 1

    profile = tempfile.mkdtemp(prefix="wb-offline-")
    chrome = launch_chrome(profile)
    cdp = None
    try:
        cdp = CDP(wait_debugger())
        cdp.attach()
        cdp.send("Network.enable")

        print("\n▸ 准备本地数据（在线状态）")
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页渲染")
        cdp.wait_for("(async()=>{var r=await navigator.serviceWorker.ready;return !!r.active})()",
                     "Service Worker 激活", timeout=25)

        cdp.eval(BIG_IMAGE + """
          async function add(name){
            var f = await bigFile(2400, 3200, name);
            var src = await Img.decode(f);
            var img = await Img.persist(src, {alpha:false});
            Img.release(src);
            var full = await Store.getBlob(img.fullId);
            await Store.put(Store.S.clothes, {
              id: Store.uid('cloth'), name:name, category:'上衣', season:'四季',
              color:'', brand:'', price:199, buyDate:'', note:'',
              fullId:img.fullId, thumbId:img.thumbId, w:img.w, h:img.h,
              createdAt:Date.now(), updatedAt:Date.now()
            });
            return {raw:f.size, stored:full.size, w:img.w, h:img.h};
          }
          window.__sizes = [];
          for (var i=0;i<6;i++){ window.__sizes.push(await add('大图'+i)); }
          return true;
        """)
        sizes = cdp.eval("return window.__sizes;")
        raw_total = sum(s["raw"] for s in sizes)
        stored_total = sum(s["stored"] for s in sizes)
        check("2400x3200 大图落库后自动降到 1280 内",
              all(max(s["w"], s["h"]) <= 1280 for s in sizes),
              f"{sizes[0]['w']}x{sizes[0]['h']}")
        check("大图存储体积显著压缩",
              stored_total < raw_total * 0.5,
              f"原始 {raw_total/1024:.0f}KB → 落库 {stored_total/1024:.0f}KB")

        print("\n▸ 列表滚动后的 ObjectURL 数量")
        cdp.goto(BASE_URL + "#/wardrobe/closet")
        cdp.wait_for("document.querySelectorAll('[data-panel] .item-card').length===6", "6 件衣物渲染")
        time.sleep(1.2)
        live = cdp.eval("return Img.liveUrlCount();")
        check("列表只持有缩略图 URL，数量不超过条目数", live <= 6, f"live={live}")

        cdp.goto(BASE_URL + "#/")
        time.sleep(0.6)
        after_nav = cdp.eval("return Img.liveUrlCount();")
        check("离开列表后 URL 被回收", after_nav == 0, f"live={after_nav}")

        print("\n▸ 切断网络")
        cdp.send("Network.emulateNetworkConditions", {
            "offline": True, "latency": 0,
            "downloadThroughput": 0, "uploadThroughput": 0,
        })
        online = cdp.eval("return navigator.onLine;")
        check("浏览器进入离线状态", online is False, f"navigator.onLine={online}")

        print("\n▸ 断网后重新加载应用")
        cdp.send("Page.reload", {"ignoreCache": False})
        cdp.wait_for("!!document.querySelector('.greeting')", "离线首页渲染", timeout=25)
        check("断网后首页正常打开", True)

        counts = cdp.eval("return document.querySelector('.tool-card--wardrobe .tool-meta').textContent;")
        check("断网后仍能读取本地统计", "6 件衣物" in (counts or ""), counts)

        cdp.goto(BASE_URL + "#/wardrobe/closet")
        cdp.wait_for("document.querySelectorAll('[data-panel] .item-card').length===6",
                     "离线衣橱列表", timeout=25)
        # 懒加载只解码视口附近的图，滚到底部触发全部加载
        cdp.eval("window.scrollTo(0, document.body.scrollHeight); return true;")
        time.sleep(0.8)
        off_loaded = cdp.wait_for(
            "Array.from(document.querySelectorAll('[data-panel] img[data-blob]'))"
            ".filter(function(i){return i.naturalWidth>0}).length===6", "离线缩略图解码", timeout=20)
        check("断网后本地图片仍可显示", bool(off_loaded), "6 张缩略图全部解码成功")

        print("\n▸ 断网后写入数据")
        wrote = cdp.eval("""
          await Store.put(Store.S.clothes, {
            id: Store.uid('cloth'), name:'离线新增外套', category:'外套', season:'冬',
            color:'', brand:'', price:0, buyDate:'', note:'断网时写入',
            fullId:null, thumbId:null, createdAt:Date.now(), updatedAt:Date.now()
          });
          return await Store.count(Store.S.clothes);
        """)
        check("断网状态下可新增数据", wrote == 7, f"共 {wrote} 条")

        cdp.goto(BASE_URL + "#/")
        cdp.goto(BASE_URL + "#/wardrobe/closet")
        check("断网新增的数据可回读", bool(cdp.wait_for(
            "(document.querySelector('[data-panel]').textContent||'').indexOf('离线新增外套')>-1",
            "离线数据回读", timeout=20)))

        print("\n▸ 断网后进入搭配画布")
        cdp.goto(BASE_URL + "#/wardrobe/outfits")
        cdp.wait_for("!!document.querySelector('[data-panel]')", "搭配页渲染")
        cdp.eval("""
          var b = document.querySelector('[data-new]');
          b.click();
          return true;
        """)
        cdp.wait_for("!!document.querySelector('[data-stage]')", "离线画布打开", timeout=20)
        cdp.wait_for("document.querySelectorAll('[data-tray-cloth] [data-ref]').length>0",
                     "离线素材托盘", timeout=20)
        tray_n = cdp.eval("return document.querySelectorAll('[data-tray-cloth] [data-ref]').length;")
        total_n = cdp.eval("return await Store.count(Store.S.clothes);")
        check("无图衣物不进素材托盘", tray_n == 6 and total_n == 7,
              f"托盘 {tray_n} 项 / 衣物共 {total_n} 件")

        cdp.eval("document.querySelector('[data-tray-cloth] [data-ref]').click(); return true;")
        n = cdp.wait_for("document.querySelectorAll('.stage-node').length", "离线加入节点")
        check("断网后搭配画布可正常使用", n == 1, f"{n} 个节点")

        print("\n▸ 恢复网络")
        cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 0,
            "downloadThroughput": -1, "uploadThroughput": -1,
        })
        check("网络恢复", cdp.eval("return navigator.onLine;") is True)

        errs = [l for l in cdp.logs if "pageerror" in l]
        check("离线流程无 JS 报错", not errs, "; ".join(errs[:3]))

    finally:
        if cdp:
            cdp.close()
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except Exception:
            chrome.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print("\n" + "=" * 56)
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    for f in FAIL:
        print("  · " + f)
    print("=" * 56)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
