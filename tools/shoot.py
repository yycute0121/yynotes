#!/usr/bin/env python3
"""渲染截图并导出计算样式快照，用于核对视觉效果。

headless Chrome 的 prefers-color-scheme 由启动参数决定，无法运行时切换，
因此浅色与深色各启动一次浏览器。输出到 tools/shots/。
"""
from __future__ import annotations

import base64
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import BASE_URL, CDP, PORT, free_port, launch_chrome, wait_debugger  # noqa: E402

OUT = Path(__file__).resolve().parent / "shots"

SEED = """
function mk(w,h,c1,c2){
  var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
  var x=cv.getContext('2d');
  x.fillStyle='#ffffff'; x.fillRect(0,0,w,h);
  var g=x.createLinearGradient(0,0,w,h);
  g.addColorStop(0,c1); g.addColorStop(1,c2);
  x.fillStyle=g;
  x.beginPath();
  x.ellipse(w/2,h/2,w*0.30,h*0.34,0,0,Math.PI*2);
  x.fill();
  return new Promise(function(r){
    cv.toBlob(function(b){ r(new File([b],'s.png',{type:'image/png'})); },'image/png');
  });
}
async function seedCloth(name,cat,season,price,c1,c2){
  var f=await mk(700,900,c1,c2);
  var src=await Img.decode(f);
  var img=await Img.persist(src,{alpha:false});
  Img.release(src);
  await Store.put(Store.S.clothes,{id:Store.uid('cloth'),name:name,category:cat,
    season:season,color:'',brand:'示例',price:price,buyDate:'2026-03-12',note:'',
    fullId:img.fullId,thumbId:img.thumbId,w:img.w,h:img.h,
    createdAt:Date.now()+Math.random(),updatedAt:Date.now()});
}
async function seedAll(){
  await seedCloth('米色针织开衫','上衣','秋',399,'#d9cfc2','#b9a894');
  await seedCloth('雾蓝色衬衫','上衣','春',329,'#cbd3d7','#9aa9b0');
  await seedCloth('黑色阔腿裤','下装','四季',259,'#8d8880','#5f5b55');
  await seedCloth('鼠尾草针织裙','连衣裙','夏',459,'#cfd6c9','#a3b09b');
  await seedCloth('驼色羊毛大衣','外套','冬',1299,'#e2d2c6','#bfa88f');
  await seedCloth('藕粉色小包','包包','四季',219,'#e0cfcb','#c2a5a0');
  var f=await mk(600,1000,'#d8d2da','#a99fb0');
  var src=await Img.decode(f);
  var av=await Img.persist(src,{alpha:false});
  Img.release(src);
  await Store.put(Store.S.avatars,{id:Store.uid('avatar'),name:'人物素材',
    fullId:av.fullId,thumbId:av.thumbId,w:av.w,h:av.h,isDefault:true,createdAt:Date.now()});
  var wishes=[['羊绒围巾','配饰',520,'https://example.com/a','hesitate'],
              ['复古乐福鞋','鞋子',899,'','want'],
              ['亚麻长裙','连衣裙',369,'','bought']];
  for (var i=0;i<wishes.length;i++){
    var w=wishes[i];
    await Store.put(Store.S.wishlist,{id:Store.uid('wish'),name:w[0],category:w[1],
      price:w[2],link:w[3],status:w[4],note:'',fullId:null,thumbId:null,
      createdAt:Date.now()-i,updatedAt:Date.now()});
  }
  return true;
}
"""


SEED_MODULES = """
function iso(off){
  var d = new Date(); d.setDate(d.getDate()+off);
  var p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
async function seedModules(){
  var ph = await (async function(){
    var f = await mk(600,800,'#cbd3d7','#8d9aa0');
    var src = await Img.decode(f);
    var r = await Img.persist(src,{alpha:false});
    Img.release(src); return r;
  })();
  await Store.put(Store.S.devices,{id:'d1',name:'iPhone 15 Pro',category:'手机',
    brand:'Apple A3102',channel:'京东自营',buyDate:iso(-420),price:8999,
    warrantyDate:iso(25),replaceYears:3,specs:'256G 原色钛金属',repairs:'',note:'',
    photos:[ph],createdAt:Date.now(),updatedAt:Date.now()});
  await Store.put(Store.S.devices,{id:'d2',name:'AirPods Pro 2',category:'耳机',
    brand:'Apple',channel:'Apple Store',buyDate:iso(-900),price:1899,
    warrantyDate:iso(-540),replaceYears:3,specs:'',repairs:'换过硅胶套',note:'',
    photos:[],createdAt:Date.now()-1,updatedAt:Date.now()});
  await Store.put(Store.S.devices,{id:'d3',name:'MacBook Air M3',category:'笔记本电脑',
    brand:'Apple',channel:'教育优惠',buyDate:iso(-200),price:9499,
    warrantyDate:iso(165),replaceYears:5,specs:'16G 512G',repairs:'',note:'',
    photos:[],createdAt:Date.now()-2,updatedAt:Date.now()});

  var stock = [['抽纸 3层','纸品',8,'包',400,3],['牛奶','食品饮料',2,'瓶',4,4],
               ['洗衣液','日化用品',1,'瓶',300,2],['酸奶','食品饮料',3,'盒',-2,0]];
  for (var i=0;i<stock.length;i++){
    var s = stock[i];
    await Store.put(Store.S.inventory,{id:'iv'+i,name:s[0],category:s[1],qty:s[2],
      unit:s[3],buyDate:iso(-10),expiryDate:iso(s[4]),price:29,place:'储物柜',
      threshold:s[5],note:'',consumes:[{id:'c'+i,qty:1,date:iso(-2),note:'',
      createdAt:Date.now()}],createdAt:Date.now()-i,updatedAt:Date.now()});
  }

  var cover = await (async function(){
    var f = await mk(700,500,'#e2d2c6','#bfa88f');
    var src = await Img.decode(f);
    var r = await Img.persist(src,{alpha:false});
    Img.release(src); return r;
  })();
  await Store.put(Store.S.projects,{id:'p1',name:'2027 春季婚礼',category:'婚礼筹备',
    brief:'预算 20 万，60 人规模，江浙一带草坪',
    startDate:iso(-40),dueDate:iso(85),budget:200000,
    coverFullId:cover.fullId,coverThumbId:cover.thumbId,
    tasks:[{id:'t1',title:'预订场地',status:'done',due:'',note:'已付定金',createdAt:Date.now()},
           {id:'t2',title:'选婚纱',status:'doing',due:iso(18),note:'',createdAt:Date.now()},
           {id:'t3',title:'定婚礼摄影',status:'todo',due:iso(35),note:'',createdAt:Date.now()},
           {id:'t4',title:'发喜帖',status:'todo',due:'',note:'',createdAt:Date.now()}],
    expenses:[{id:'e1',name:'场地定金',amount:50000,date:iso(-30),category:'场地',note:'',createdAt:Date.now()},
              {id:'e2',name:'婚纱租赁',amount:12000,date:iso(-8),category:'服装',note:'',createdAt:Date.now()}],
    logs:[{id:'l1',date:iso(-12),content:'与策划确认了流程与时间表，摄影下周比稿',createdAt:Date.now()}],
    attachments:[],createdAt:Date.now(),updatedAt:Date.now()});
  await Store.put(Store.S.projects,{id:'p2',name:'老房装修',category:'装修',
    brief:'两室一厅局部翻新',startDate:iso(-90),dueDate:iso(-5),budget:120000,
    coverFullId:null,coverThumbId:null,
    tasks:[{id:'t5',title:'水电改造',status:'done',due:'',note:'',createdAt:Date.now()},
           {id:'t6',title:'厨卫防水',status:'done',due:'',note:'',createdAt:Date.now()}],
    expenses:[{id:'e3',name:'主材',amount:68000,date:iso(-60),category:'',note:'',createdAt:Date.now()}],
    logs:[],attachments:[],createdAt:Date.now()-1,updatedAt:Date.now()-1});

  await Store.put(Store.S.notes,{id:'n1',title:'装修灵感',
    body:'客厅想做无主灯，餐边柜留插座位；阳台考虑洗烘一体机的尺寸。',
    images:[ph],createdAt:Date.now(),updatedAt:Date.now()});
  await Store.put(Store.S.notes,{id:'n2',title:'',
    body:'记得周五还书，顺便去邮局取快递。',
    images:[],createdAt:Date.now()-86400000,updatedAt:Date.now()});
  return true;
}
"""


def shoot(cdp: CDP, name: str, wait_sel: str) -> None:
    cdp.wait_for(f"!!document.querySelector('{wait_sel}')", name)
    time.sleep(1.3)
    data = cdp.send("Page.captureScreenshot", {
        "format": "png", "captureBeyondViewport": True,
    })["data"]
    path = OUT / f"{name}.png"
    path.write_bytes(base64.b64decode(data))
    print(f"  已保存 {path.name} ({path.stat().st_size // 1024} KB)")


def session(color_scheme: str):
    profile = tempfile.mkdtemp(prefix=f"wb-shot-{color_scheme}-")
    chrome = launch_chrome(profile, color_scheme=color_scheme)
    cdp = CDP(wait_debugger())
    cdp.attach()
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": 414, "height": 896, "deviceScaleFactor": 2, "mobile": True,
    })
    return chrome, cdp, profile


def teardown(chrome, cdp, profile) -> None:
    if cdp:
        cdp.close()
    chrome.terminate()
    try:
        chrome.wait(timeout=10)
    except Exception:
        chrome.kill()
    shutil.rmtree(profile, ignore_errors=True)


def main() -> int:
    if not free_port(PORT):
        print(f"端口 {PORT} 被占用")
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []

    print("▸ 浅色模式")
    chrome, cdp, profile = session("light")
    try:
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页")
        scheme = cdp.eval("return matchMedia('(prefers-color-scheme: dark)').matches;")
        if scheme:
            print("  ⚠️ 仍处于深色模式，配色核对可能不准")
        cdp.eval(SEED + "return await seedAll();")

        cdp.goto(BASE_URL + "#/")
        shoot(cdp, "01-home", ".tool-card--wardrobe .tool-meta")
        cdp.goto(BASE_URL + "#/wardrobe/closet")
        shoot(cdp, "02-closet", "[data-panel] .item-card")
        cdp.goto(BASE_URL + "#/wardrobe/wishlist")
        shoot(cdp, "03-wishlist", "[data-panel] .row-card")
        cdp.goto(BASE_URL + "#/wardrobe/avatars")
        shoot(cdp, "04-avatars", "[data-panel] .item-card")

        # 画布编辑器
        cdp.goto(BASE_URL + "#/wardrobe/outfits")
        cdp.wait_for("!!document.querySelector('[data-new]')", "搭配列表")
        cdp.eval("document.querySelector('[data-new]').click(); return true;")
        cdp.wait_for("document.querySelectorAll('[data-tray-cloth] [data-ref]').length>0", "托盘")
        cdp.eval("""
          document.querySelector('[data-tray-avatar] [data-ref]').click();
          var items = document.querySelectorAll('[data-tray-cloth] [data-ref]');
          items[0].click(); items[2].click();
          var ns = document.querySelectorAll('.stage-node');
          if(ns[1]) ns[1].style.transform = 'translate3d(38px, 96px, 0)';
          if(ns[2]) ns[2].style.transform = 'translate3d(168px, 300px, 0)';
          return true;
        """)
        shoot(cdp, "05-canvas", ".stage-node")

        # 表单抽屉
        cdp.goto(BASE_URL + "#/wardrobe/closet")
        cdp.wait_for("!!document.querySelector('.fab')", "悬浮按钮")
        cdp.eval("document.querySelector('.fab').click(); return true;")
        shoot(cdp, "06-form-sheet", ".sheet-body [data-f]")

        # 其余三个模块
        # SEED 里定义了 mk()，模块种子数据复用它生成图片
        cdp.eval(SEED + SEED_MODULES + "return await seedModules();")
        cdp.goto(BASE_URL + "#/devices")
        shoot(cdp, "07-devices", "[data-panel] .row-card")
        cdp.goto(BASE_URL + "#/inventory")
        shoot(cdp, "08-inventory", "[data-panel] .row-card")
        cdp.goto(BASE_URL + "#/events/projects")
        cdp.wait_for("!!document.querySelector('[data-panel] .row-card')", "项目列表")
        cdp.eval("document.querySelector('[data-open]').click(); return true;")
        shoot(cdp, "09-project", "[data-add-task]")
        cdp.goto(BASE_URL + "#/events/notes")
        shoot(cdp, "10-notes", "[data-panel] .row-card")

        cdp.goto(BASE_URL + "#/settings")
        shoot(cdp, "11-settings", "[data-export]")

        # 首页提醒条：模拟 30 天未备份
        cdp.eval("""
          var d = new Date(); d.setDate(d.getDate() - 30);
          await Store.setMeta(Health.K.reminder, 14);
          await Store.setMeta(Health.K.lastAt, d.toISOString());
          await Store.setMeta(Health.K.lastTotal, 2);
          await Store.setMeta(Health.K.dismissed, '');
          return true;
        """)
        cdp.goto(BASE_URL + "#/")
        shoot(cdp, "12-home-notice", "[data-notice]")
        cdp.eval("await Store.setMeta(Health.K.lastAt, new Date().toISOString()); return true;")

        # 计算样式快照
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("document.querySelectorAll('.tool-card').length===4", "首页卡片")
        meta = cdp.eval("""
          function bg(el){ return getComputedStyle(el).backgroundColor; }
          var cards = Array.from(document.querySelectorAll('.tool-card')).map(function(c){
            var r = c.getBoundingClientRect();
            return {
              title: c.querySelector('.tool-title').textContent,
              bg: bg(c),
              radius: getComputedStyle(c).borderTopLeftRadius,
              shadow: getComputedStyle(c).boxShadow,
              w: Math.round(r.width), h: Math.round(r.height)
            };
          });
          var g = document.querySelector('.greeting');
          return {
            dark: matchMedia('(prefers-color-scheme: dark)').matches,
            pageBg: bg(document.body),
            ink: getComputedStyle(g).color,
            greetSize: getComputedStyle(g).fontSize,
            cards: cards,
            footer: document.querySelector('.page-foot').textContent.trim(),
            viewport: {w: innerWidth, h: innerHeight}
          };
        """)
        (OUT / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        print("  已保存 meta.json（计算样式快照）")

        errors += [l for l in cdp.logs if "pageerror" in l]
    finally:
        teardown(chrome, cdp, profile)

    print("\n▸ 深色模式对照")
    chrome, cdp, profile = session("light")
    try:
        # 深色是用户主动选择的，不跟随系统，所以先写入偏好再刷新
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页")
        cdp.eval("localStorage.setItem('wb_theme','dark'); return true;")
        cdp.send("Page.reload", {"ignoreCache": False})
        cdp.wait_for(
            "getComputedStyle(document.body).backgroundColor === 'rgb(35, 33, 30)'",
            "深色生效")
        shoot(cdp, "13-home-dark", ".tool-list")
        errors += [l for l in cdp.logs if "pageerror" in l]
    finally:
        teardown(chrome, cdp, profile)

    if errors:
        print("\n页面报错：")
        for e in errors[:5]:
            print("  " + e)
        return 1
    print("\n截图完成，无页面报错")
    return 0


if __name__ == "__main__":
    sys.exit(main())
