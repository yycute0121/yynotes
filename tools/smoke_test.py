#!/usr/bin/env python3
"""WorkBuddy 冒烟测试：通过 Chrome DevTools Protocol 真实驱动页面。

覆盖：首页渲染、IndexedDB 打开、图片压缩落库、衣物增删改、
想买清单、数字人物、搭配画布节点与预览图生成、离线资源缓存。

用法（需先启动 http://127.0.0.1:8777 静态服务）：
    .venv/bin/python tools/smoke_test.py
"""
from __future__ import annotations

import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE_URL = "http://127.0.0.1:8777/"
PORT = 9333


def free_port(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def launch_chrome(profile: str, color_scheme: str = "light") -> subprocess.Popen:
    """启动 headless Chrome。

    headless=new 默认 prefers-color-scheme 为 dark，这里用 blink-settings
    显式指定，保证截图与配色核对跑在预期的配色模式下（1=light，2=dark）。
    """
    args = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"--remote-debugging-port={PORT}",
        "--remote-allow-origins=*",
        f"--user-data-dir={profile}",
        "--window-size=430,900",
        f"--blink-settings=preferredColorScheme={1 if color_scheme == 'light' else 2}",
        "about:blank",
    ]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_debugger(timeout: float = 25.0) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=2) as r:
                return json.load(r)["webSocketDebuggerUrl"]
        except Exception:
            time.sleep(0.4)
    raise RuntimeError("Chrome 调试端口未就绪")


class CDP:
    def __init__(self, url: str) -> None:
        self.ws = websocket.create_connection(url, timeout=40)
        self.seq = 0
        self.session_id: str | None = None
        self.logs: list[str] = []

    def send(self, method: str, params: dict | None = None, session: bool = True) -> dict:
        self.seq += 1
        msg: dict = {"id": self.seq, "method": method, "params": params or {}}
        if session and self.session_id:
            msg["sessionId"] = self.session_id
        self.ws.send(json.dumps(msg))
        return self._await(self.seq)

    def _await(self, want: int) -> dict:
        while True:
            raw = json.loads(self.ws.recv())
            if raw.get("method") == "Runtime.consoleAPICalled":
                args = raw["params"].get("args", [])
                text = " ".join(str(a.get("value", a.get("description", ""))) for a in args)
                self.logs.append(f"[{raw['params']['type']}] {text}")
            elif raw.get("method") == "Runtime.exceptionThrown":
                det = raw["params"]["exceptionDetails"]
                self.logs.append("[pageerror] " + det.get("text", "") + " " +
                                 str((det.get("exception") or {}).get("description", "")))
            if raw.get("id") == want:
                if "error" in raw:
                    raise RuntimeError(f"{raw['error']}")
                return raw.get("result", {})

    def attach(self) -> None:
        targets = self.send("Target.getTargets", session=False)["targetInfos"]
        page = next(t for t in targets if t["type"] == "page")
        self.session_id = self.send(
            "Target.attachToTarget",
            {"targetId": page["targetId"], "flatten": True},
            session=False,
        )["sessionId"]
        self.send("Runtime.enable")
        self.send("Page.enable")

    def goto(self, url: str) -> None:
        self.send("Page.navigate", {"url": url})

    def eval(self, expr: str, timeout_ms: int = 40000):
        res = self.send("Runtime.evaluate", {
            "expression": f"(async () => {{ {expr} }})()",
            "awaitPromise": True,
            "returnByValue": True,
            "timeout": timeout_ms,
        })
        if res.get("exceptionDetails"):
            det = res["exceptionDetails"]
            desc = (det.get("exception") or {}).get("description") or det.get("text")
            raise AssertionError(f"页面执行异常: {desc}")
        return res["result"].get("value")

    def wait_for(self, expr: str, label: str, timeout: float = 20.0):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            last = self.eval(f"return ({expr});")
            if last:
                return last
            time.sleep(0.25)
        raise AssertionError(f"等待超时: {label}（最后一次取值 {last!r}）")

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass


PASS: list[str] = []
FAIL: list[str] = []


def check(name: str, ok: bool, extra: str = "") -> None:
    (PASS if ok else FAIL).append(name + (f" — {extra}" if extra else ""))
    print(("  ✅ " if ok else "  ❌ ") + name + (f"  {extra}" if extra else ""))


# 生成一张带纯白边框的测试图，用于验证压缩与去背
MAKE_TEST_FILE = """
function makeFile(name){
  var c = document.createElement('canvas');
  c.width = 640; c.height = 800;
  var x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0,0,640,800);
  x.fillStyle = '#8d7f6e'; x.fillRect(160,200,320,400);
  return new Promise(function(res){
    c.toBlob(function(b){ res(new File([b], name, {type:'image/png'})); }, 'image/png');
  });
}
"""


def main() -> int:
    if not free_port(PORT):
        print(f"端口 {PORT} 被占用，请先释放")
        return 1

    profile = tempfile.mkdtemp(prefix="wb-smoke-")
    chrome = launch_chrome(profile)
    cdp = None
    try:
        cdp = CDP(wait_debugger())
        cdp.attach()

        print("\n▸ 首页与数据层")
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!(window.App && window.Store && window.Img && window.UI && window.Wardrobe)",
                     "脚本全部加载")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页渲染完成")

        title = cdp.eval("return document.querySelector('.greeting').textContent;")
        check("首页问候语按时段生成", "今天想做点什么" in (title or ""), title)

        cards = cdp.eval("return document.querySelectorAll('.tool-card').length;")
        check("四张 TOOLS 卡片渲染", cards == 4, f"实际 {cards} 张")

        foot = cdp.eval("return document.querySelector('.page-foot').textContent;")
        check("底部本机存储说明存在", "仅保存在本机" in (foot or ""))

        db_ok = cdp.eval("await Store.open(); return true;")
        check("IndexedDB 打开成功", db_ok is True)

        print("\n▸ 图片压缩与落库")
        persisted = cdp.eval(MAKE_TEST_FILE + """
          var f = await makeFile('t.png');
          var src = await Img.decode(f);
          var res = await Img.persist(src, {alpha:false});
          Img.release(src);
          var full = await Store.getBlob(res.fullId);
          var thumb = await Store.getBlob(res.thumbId);
          return {w:res.w, h:res.h, full:full.size, thumb:thumb.size, raw:f.size};
        """)
        check("落库长边不超过 1280", max(persisted["w"], persisted["h"]) <= 1280,
              f"{persisted['w']}x{persisted['h']}")
        check("缩略图明显小于原图", persisted["thumb"] < persisted["full"],
              f"thumb {persisted['thumb']}B < full {persisted['full']}B")

        print("\n▸ 本地去背算法")
        cut = cdp.eval(MAKE_TEST_FILE + """
          var f = await makeFile('c.png');
          var src = await Img.decode(f);
          var cv = Img.removeBackground(src, 30);
          var d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
          var corner = d[3];
          var mid = d[((Math.floor(cv.height/2)*cv.width)+Math.floor(cv.width/2))*4+3];
          Img.release(src); Img.disposeCanvas(cv);
          return {corner:corner, mid:mid};
        """)
        check("白色背景被去除（四角透明）", cut["corner"] == 0, f"alpha={cut['corner']}")
        check("主体被保留（中心不透明）", cut["mid"] > 200, f"alpha={cut['mid']}")

        print("\n▸ 我的衣橱 CRUD")
        cdp.goto(BASE_URL + "#/wardrobe/closet")
        cdp.wait_for("!!document.querySelector('[data-panel] .empty, [data-panel] .grid')", "衣橱面板渲染")
        check("衣橱空状态提示", cdp.eval(
            "return (document.querySelector('[data-panel]').textContent||'').indexOf('衣橱还是空的')>-1;"))

        cdp.eval(MAKE_TEST_FILE + """
          async function add(name, cat, season, price){
            var f = await makeFile(name+'.png');
            var src = await Img.decode(f);
            var img = await Img.persist(src, {alpha:false});
            Img.release(src);
            await Store.put(Store.S.clothes, {
              id: Store.uid('cloth'), name:name, category:cat, season:season,
              color:'米白', brand:'测试', price:price, buyDate:'2026-03-01', note:'',
              fullId:img.fullId, thumbId:img.thumbId, w:img.w, h:img.h,
              createdAt:Date.now(), updatedAt:Date.now()
            });
          }
          await add('米色针织开衫','上衣','秋',399);
          await add('黑色阔腿裤','下装','四季',259);
          await add('羊毛大衣','外套','冬',1299);
          return true;
        """)
        cdp.goto(BASE_URL + "#/")
        cdp.goto(BASE_URL + "#/wardrobe/closet")
        cdp.wait_for("document.querySelectorAll('[data-panel] .item-card').length===3", "3 件衣物入列")
        check("衣物列表渲染 3 件", True)

        loaded = cdp.wait_for(
            "Array.from(document.querySelectorAll('[data-panel] img[data-blob]'))"
            ".filter(function(i){return i.classList.contains('is-loaded') && i.naturalWidth>0}).length",
            "缩略图懒加载完成", timeout=15)
        check("缩略图懒加载渲染成功", loaded == 3, f"已加载 {loaded} 张")

        cdp.eval("""
          var box = document.querySelector('[data-kw]');
          box.value = '大衣';
          box.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        """)
        found = cdp.wait_for("document.querySelectorAll('[data-panel] .item-card').length===1",
                             "关键词搜索命中 1 件")
        check("关键词搜索生效", bool(found))

        cdp.eval("""
          var box = document.querySelector('[data-kw]');
          box.value = '';
          box.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        """)
        cdp.wait_for("document.querySelectorAll('[data-panel] .item-card').length===3", "搜索清空复原")

        cdp.eval("""
          var chips = Array.from(document.querySelectorAll('[data-cat] .chip'));
          var target = chips.filter(function(c){return c.dataset.v==='外套'})[0];
          target.click();
          return true;
        """)
        check("分类筛选生效", bool(cdp.wait_for(
            "document.querySelectorAll('[data-panel] .item-card').length===1", "分类筛选")))
        cdp.eval("""
          var chips = Array.from(document.querySelectorAll('[data-cat] .chip'));
          chips.filter(function(c){return c.dataset.v==='全部'})[0].click();
          return true;
        """)
        cdp.wait_for("document.querySelectorAll('[data-panel] .item-card').length===3", "筛选复原")

        # 删除会连带回收图片 Blob
        before = cdp.eval("return await Store.count(Store.S.blobs);")
        cdp.eval("""
          var rows = await Wardrobe.listClothes();
          await Wardrobe.removeWithImages(Store.S.clothes, rows[0]);
          return true;
        """)
        after = cdp.eval("return await Store.count(Store.S.blobs);")
        check("删除衣物同时回收图片 Blob", after == before - 2, f"{before} → {after}")

        print("\n▸ 想买清单")
        cdp.eval("""
          await Store.put(Store.S.wishlist, {
            id: Store.uid('wish'), name:'羊绒围巾', category:'配饰', price:520,
            link:'https://example.com/item/1', status:'hesitate', note:'等降价',
            fullId:null, thumbId:null, createdAt:Date.now(), updatedAt:Date.now()
          });
          await Store.put(Store.S.wishlist, {
            id: Store.uid('wish'), name:'乐福鞋', category:'鞋子', price:899,
            link:'', status:'want', note:'', fullId:null, thumbId:null,
            createdAt:Date.now(), updatedAt:Date.now()
          });
          return true;
        """)
        cdp.goto(BASE_URL + "#/wardrobe/wishlist")
        cdp.wait_for("document.querySelectorAll('[data-panel] .row-card').length===2", "想买清单渲染")
        check("想买清单渲染 2 条", True)
        check("状态标签正确显示", cdp.eval(
            "return (document.querySelector('[data-panel]').textContent||'').indexOf('犹豫')>-1;"))
        cdp.eval("""
          var chips = Array.from(document.querySelectorAll('[data-wf] .chip'));
          chips.filter(function(c){return c.dataset.v==='hesitate'})[0].click();
          return true;
        """)
        check("按状态筛选生效", bool(cdp.wait_for(
            "document.querySelectorAll('[data-panel] .row-card').length===1", "状态筛选")))

        print("\n▸ 数字人物")
        cdp.eval(MAKE_TEST_FILE + """
          var f = await makeFile('avatar.png');
          var src = await Img.decode(f);
          var img = await Img.persist(src, {alpha:false});
          Img.release(src);
          await Store.put(Store.S.avatars, {
            id: Store.uid('avatar'), name:'人物素材', fullId:img.fullId,
            thumbId:img.thumbId, w:img.w, h:img.h, isDefault:true, createdAt:Date.now()
          });
          return true;
        """)
        cdp.goto(BASE_URL + "#/wardrobe/avatars")
        cdp.wait_for("document.querySelectorAll('[data-panel] .item-card').length===1", "人物素材渲染")
        check("人物素材渲染并标记默认", cdp.eval(
            "return (document.querySelector('[data-panel]').textContent||'').indexOf('默认')>-1;"))
        check("明确声明不做 AI 试穿", cdp.eval(
            "return (document.querySelector('[data-panel]').textContent||'').indexOf('不做自动试穿')>-1;"))

        print("\n▸ 搭配画布")
        cdp.goto(BASE_URL + "#/wardrobe/outfits")
        cdp.wait_for("!!document.querySelector('[data-panel] .empty')", "搭配列表空状态")
        cdp.eval("document.querySelector('[data-new]').click(); return true;")
        cdp.wait_for("!!document.querySelector('[data-stage]')", "画布编辑器打开")
        cdp.wait_for("document.querySelectorAll('[data-tray-cloth] [data-ref]').length>0", "衣物托盘加载")

        cdp.eval("""
          document.querySelector('[data-tray-avatar] [data-ref]').click();
          var items = document.querySelectorAll('[data-tray-cloth] [data-ref]');
          items[0].click();
          if (items[1]) items[1].click();
          return true;
        """)
        nodes = cdp.wait_for("document.querySelectorAll('.stage-node').length", "节点入画布")
        check("画布加入 3 个素材节点", nodes == 3, f"实际 {nodes} 个")

        geom = cdp.eval("""
          var el = document.querySelectorAll('.stage-node')[2];
          var r = el.getBoundingClientRect();
          return {w: Math.round(r.width), h: Math.round(r.height),
                  t: el.style.transform, z: el.style.zIndex};
        """)
        check("节点尺寸按比例布局", geom["w"] > 0 and geom["h"] > 0,
              f"{geom['w']}x{geom['h']}")
        check("节点使用 translate3d 合成层", "translate3d" in (geom["t"] or ""), geom["t"])

        # 模拟触摸拖拽
        drag = cdp.eval("""
          var el = document.querySelectorAll('.stage-node')[2];
          var before = el.style.transform;
          function pe(type, x, y){
            return new PointerEvent(type, {pointerId:1, clientX:x, clientY:y,
              bubbles:true, cancelable:true, pointerType:'touch', isPrimary:true});
          }
          var r = el.getBoundingClientRect();
          var cx = r.left + r.width/2, cy = r.top + r.height/2;
          el.dispatchEvent(pe('pointerdown', cx, cy));
          el.dispatchEvent(pe('pointermove', cx + 40, cy + 55));
          el.dispatchEvent(pe('pointerup', cx + 40, cy + 55));
          return {before: before, after: el.style.transform,
                  active: el.classList.contains('is-active')};
        """)
        check("触摸拖拽改变节点位置", drag["before"] != drag["after"],
              f"{drag['before']} → {drag['after']}")
        check("拖拽后节点被选中", drag["active"] is True)

        resize = cdp.eval("""
          var el = document.querySelectorAll('.stage-node')[2];
          var w0 = el.getBoundingClientRect().width;
          document.querySelector('[data-bigger]').click();
          var w1 = el.getBoundingClientRect().width;
          document.querySelector('[data-smaller]').click();
          document.querySelector('[data-smaller]').click();
          var w2 = el.getBoundingClientRect().width;
          return {w0:Math.round(w0), w1:Math.round(w1), w2:Math.round(w2)};
        """)
        check("按钮放大生效", resize["w1"] > resize["w0"], f"{resize['w0']} → {resize['w1']}")
        check("按钮缩小生效", resize["w2"] < resize["w1"], f"{resize['w1']} → {resize['w2']}")

        layer = cdp.eval("""
          var el = document.querySelectorAll('.stage-node')[2];
          var z0 = Number(el.style.zIndex||0);
          document.querySelector('[data-up]').click();
          var z1 = Number(el.style.zIndex||0);
          return {z0:z0, z1:z1};
        """)
        check("图层上移生效", layer["z1"] > layer["z0"], f"z {layer['z0']} → {layer['z1']}")

        # 保存搭配并生成预览图
        cdp.eval("document.querySelector('[data-save]').click(); return true;")
        cdp.wait_for("!!document.querySelector('[data-name]')", "保存抽屉打开")
        cdp.eval("""
          var i = document.querySelector('[data-name]');
          i.value = '秋日通勤';
          i.dispatchEvent(new Event('input', {bubbles:true}));
          var btns = document.querySelectorAll('.sheet-foot [data-action]');
          btns[btns.length-1].click();
          return true;
        """)
        saved = cdp.wait_for("""
          (async function(){
            var rows = await Store.getAll(Store.S.outfits);
            if(!rows.length) return null;
            var o = rows[0];
            var prev = o.previewId ? await Store.getBlob(o.previewId) : null;
            return {name:o.name, nodes:o.nodes.length, preview: prev ? prev.size : 0,
                    xr: o.nodes[2].xr, wr: o.nodes[2].wr};
          })()
        """, "搭配方案落库", timeout=30)
        check("搭配方案保存成功", saved["name"] == "秋日通勤" and saved["nodes"] == 3,
              f"{saved['name']} / {saved['nodes']} 个节点")
        check("自动生成搭配预览图", saved["preview"] > 1000, f"{saved['preview']} B")
        check("节点坐标以比例保存", 0 <= saved["xr"] <= 1 and 0 < saved["wr"] < 2,
              f"xr={saved['xr']:.3f} wr={saved['wr']:.3f}")

        cdp.wait_for("!!document.querySelector('[data-panel] .item-card')", "返回搭配列表")
        check("搭配列表显示预览卡片", cdp.eval(
            "return (document.querySelector('[data-panel]').textContent||'').indexOf('秋日通勤')>-1;"))
        check("保存后 hash 回到列表",
              cdp.eval("return location.hash;") == "#/wardrobe/outfits",
              cdp.eval("return location.hash;"))

        print("\n▸ 画布返回列表")
        cdp.eval("document.querySelector('[data-open]').click(); return true;")
        cdp.wait_for("!!document.querySelector('[data-stage]')", "重新打开画布")
        check("编辑已有搭配时 hash 带 id",
              cdp.eval("return location.hash;").startswith("#/wardrobe/outfits/"),
              cdp.eval("return location.hash;"))

        # 画布有内容时返回会二次确认
        cdp.eval("document.querySelector('[data-back]').click(); return true;")
        cdp.wait_for("!!document.querySelector('.sheet-foot [data-action]')", "离开确认")
        cdp.eval("""
          var btns = document.querySelectorAll('.sheet-foot [data-action]');
          btns[btns.length-1].click();
          return true;
        """)
        left = True
        try:
            cdp.wait_for(
                "!!document.querySelector('[data-panel] .item-card') && "
                "!document.querySelector('[data-stage]')",
                "退回列表", timeout=12)
        except AssertionError:
            left = False
        check("确认离开后回到搭配列表", left, cdp.eval("return location.hash;"))

        cdp.goto(BASE_URL + "#/wardrobe/outfits/not_exist")
        gone = True
        try:
            cdp.wait_for("location.hash === '#/wardrobe/outfits'",
                         "不存在的搭配退回列表", timeout=12)
        except AssertionError:
            gone = False
        check("打开不存在的搭配会退回列表", gone, cdp.eval("return location.hash;"))

        print("\n▸ 内存回收")
        leak = cdp.eval("""
          var before = Img.liveUrlCount();
          Img.releaseGroup('wardrobe');
          Img.releaseGroup('outfit');
          return {before: before, after: Img.liveUrlCount()};
        """)
        check("ObjectURL 可按组回收", leak["after"] == 0,
              f"{leak['before']} → {leak['after']}")

        print("\n▸ 数据与存储页")
        cdp.goto(BASE_URL + "#/settings")
        cdp.wait_for("!!document.querySelector('.usage')", "存储用量渲染")
        check("显示本机存储占用", cdp.eval(
            "return (document.querySelector('.usage').textContent||'').indexOf('本机已用')>-1;"))

        print("\n▸ PWA 与离线")
        sw = cdp.eval("""
          if(!('serviceWorker' in navigator)) return {ok:false, reason:'不支持'};
          var reg = await navigator.serviceWorker.ready;
          var keys = await caches.keys();
          var cache = await caches.open(keys[0]);
          var need = ['./index.html','./css/app.css','./js/wardrobe.js','./manifest.json'];
          var miss = [];
          for (var i=0;i<need.length;i++){
            var hit = await cache.match(need[i]);
            if(!hit) miss.push(need[i]);
          }
          return {ok:!!reg.active, keys:keys, miss:miss};
        """, timeout_ms=30000)
        check("Service Worker 已激活", sw.get("ok") is True, str(sw.get("keys")))
        check("离线缓存包含核心资源", sw.get("miss") == [], f"缺失 {sw.get('miss')}")

        mf = cdp.eval("""
          var r = await fetch('manifest.json');
          var j = await r.json();
          return {display:j.display, icons:j.icons.length, start:j.start_url,
                  maskable: j.icons.some(function(i){return i.purpose==='maskable'})};
        """)
        check("manifest 为 standalone 独立窗口", mf["display"] == "standalone")
        check("包含 maskable 图标", mf["maskable"] is True, f"共 {mf['icons']} 个图标")

        no_remote = cdp.eval("""
          var srcs = Array.from(document.querySelectorAll('script[src],link[href]'))
            .map(function(n){return n.src||n.href;})
            .filter(function(u){ return u && u.indexOf(location.origin)!==0; });
          return srcs;
        """)
        check("无任何外部 CDN 依赖", no_remote == [], str(no_remote))

        print("\n▸ 页面错误检查")
        errs = [l for l in cdp.logs if "pageerror" in l or "[error]" in l]
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

    print("\n" + "=" * 56)
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    if FAIL:
        print("\n失败明细：")
        for f in FAIL:
            print("  · " + f)
    print("=" * 56)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
