#!/usr/bin/env python3
"""三个新模块 + 备份恢复的功能测试。

覆盖：电子物品档案（使用天数/保修/更换提醒）、生活用品库存
（保质期分级/消耗流水/补货）、事件记录本（笔记/项目/任务进度/
预算统计/附件/日志）、自定义分类增删改、ZIP 导出与导入恢复。

用法：.venv/bin/python tools/modules_test.py
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import (  # noqa: E402
    BASE_URL, CDP, FAIL, PASS, PORT, check, free_port, launch_chrome, wait_debugger,
)

MAKE_IMG = """
function mkFile(name){
  var c = document.createElement('canvas');
  c.width = 600; c.height = 800;
  var x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0,0,600,800);
  x.fillStyle = '#8d7f6e'; x.fillRect(150,200,300,400);
  return new Promise(function(r){
    c.toBlob(function(b){ r(new File([b], name, {type:'image/png'})); }, 'image/png');
  });
}
async function mkPhoto(){
  var f = await mkFile('p.png');
  var src = await Img.decode(f);
  var res = await Img.persist(src, {alpha:false});
  Img.release(src);
  return res;
}
function iso(offsetDays){
  var d = new Date();
  d.setDate(d.getDate() + offsetDays);
  var p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
}
"""


def main() -> int:
    if not free_port(PORT):
        print(f"端口 {PORT} 被占用")
        return 1

    profile = tempfile.mkdtemp(prefix="wb-modules-")
    chrome = launch_chrome(profile)
    cdp = None
    try:
        cdp = CDP(wait_debugger())
        cdp.attach()
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("!!document.querySelector('.greeting')", "首页")
        cdp.wait_for("!!(window.Devices && window.Inventory && window.Events && window.Backup "
                     "&& window.Common)", "新模块脚本加载")

        print("▸ 数据层升级")
        ver = cdp.eval("""
          var db = await Store.open();
          return {version: db.version, stores: Array.from(db.objectStoreNames).sort()};
        """)
        need = ['avatars', 'blobs', 'clothes', 'devices', 'inventory',
                'meta', 'notes', 'outfits', 'projects', 'wishlist']
        check("数据库升级到 v2", ver["version"] == 2, f"version={ver['version']}")
        check("新表全部建好", ver["stores"] == need, str(ver["stores"]))

        # ============ 电子物品档案 ============
        print("\n▸ 电子物品档案")
        cdp.eval(MAKE_IMG + """
          var ph = await mkPhoto();
          await Store.put(Store.S.devices, {
            id: 'dev_test_1', name: 'iPhone 15 Pro', category: '手机',
            brand: 'Apple A3102', channel: '京东自营',
            buyDate: iso(-400), price: 8999,
            warrantyDate: iso(20), replaceYears: 3,
            specs: '256G 原色钛金属', repairs: '', note: '',
            photos: [ph], createdAt: Date.now(), updatedAt: Date.now()
          });
          await Store.put(Store.S.devices, {
            id: 'dev_test_2', name: 'AirPods Pro 2', category: '耳机',
            brand: 'Apple', channel: '', buyDate: iso(-1200), price: 1899,
            warrantyDate: iso(-800), replaceYears: 3,
            specs: '', repairs: '换过硅胶套', note: '',
            photos: [], createdAt: Date.now()-1, updatedAt: Date.now()
          });
          return true;
        """)

        calc = cdp.eval("""
          var rows = await Devices.list();
          var a = rows.filter(function(r){return r.id==='dev_test_1'})[0];
          var b = rows.filter(function(r){return r.id==='dev_test_2'})[0];
          return {
            usedA: Devices.usedDays(a),
            warrA: Devices.warranty(a),
            repA: Devices.replacement(a),
            warrB: Devices.warranty(b),
            repB: Devices.replacement(b)
          };
        """)
        check("使用天数按购入日期实时算", calc["usedA"] == 400, f"{calc['usedA']} 天")
        check("保修 20 天内标为警示", calc["warrA"]["cls"] == "badge--warn",
              calc["warrA"]["text"])
        check("已过保正确识别", calc["warrB"]["text"] == "已过保", calc["warrB"]["text"])
        check("超过更换年限给出提示",
              calc["repB"]["cls"] == "badge--risk", calc["repB"]["text"])

        cdp.goto(BASE_URL + "#/devices")
        cdp.wait_for("document.querySelectorAll('[data-panel] .row-card').length===2",
                     "设备列表渲染")
        txt = cdp.eval("return document.querySelector('[data-panel]').textContent;")
        check("列表展示已用天数与保修状态",
              "已用 400 天" in txt and "已过保" in txt)
        check("汇总条显示台数与投入", "台设备" in txt and "累计投入" in txt)

        cdp.eval("""
          var box = document.querySelector('[data-kw]');
          box.value = 'AirPods';
          box.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        """)
        check("设备关键词搜索", bool(cdp.wait_for(
            "document.querySelectorAll('[data-panel] .row-card').length===1", "搜索")))
        cdp.eval("""
          var box = document.querySelector('[data-kw]');
          box.value = '';
          box.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        """)
        cdp.wait_for("document.querySelectorAll('[data-panel] .row-card').length===2", "复原")

        cdp.eval("""
          var chips = Array.from(document.querySelectorAll('[data-sort] .chip[data-v]'));
          chips.filter(function(c){return c.dataset.v==='warranty'})[0].click();
          return true;
        """)
        time.sleep(0.5)
        order = cdp.eval("""
          return Array.from(document.querySelectorAll('[data-panel] .item-name'))
            .map(function(n){return n.textContent;});
        """)
        check("按保修到期排序生效", order[0].startswith("AirPods"), str(order))

        print("\n▸ 自定义分类")
        cats = cdp.eval("""
          await Common.Cats.save(Devices.CAT_KEY, ['手机','耳机','无人机']);
          var list = await Common.Cats.load(Devices.CAT_KEY, Devices.PRESETS);
          return list;
        """)
        check("分类可自定义保存并读回", "无人机" in cats, str(cats))
        cdp.eval("await Common.Cats.save(Devices.CAT_KEY, Devices.PRESETS); return true;")

        # ============ 生活用品库存 ============
        print("\n▸ 生活用品库存")
        cdp.eval(MAKE_IMG + """
          await Store.put(Store.S.inventory, {
            id: 'inv_1', name: '抽纸 3层', category: '纸品', qty: 8, unit: '包',
            buyDate: iso(-10), expiryDate: iso(400), price: 39,
            place: '阳台储物柜', threshold: 3, note: '', consumes: [],
            createdAt: Date.now(), updatedAt: Date.now()
          });
          await Store.put(Store.S.inventory, {
            id: 'inv_2', name: '牛奶', category: '食品饮料', qty: 2, unit: '瓶',
            buyDate: iso(-3), expiryDate: iso(4), price: 12,
            place: '冰箱', threshold: 4, note: '', consumes: [],
            createdAt: Date.now()-1, updatedAt: Date.now()
          });
          await Store.put(Store.S.inventory, {
            id: 'inv_3', name: '酸奶', category: '食品饮料', qty: 1, unit: '盒',
            buyDate: iso(-30), expiryDate: iso(-2), price: 8,
            place: '冰箱', threshold: 0, note: '', consumes: [],
            createdAt: Date.now()-2, updatedAt: Date.now()
          });
          return true;
        """)

        shelf = cdp.eval("""
          var rows = await Inventory.list();
          function pick(id){ return rows.filter(function(r){return r.id===id})[0]; }
          return {
            far: Inventory.shelf(pick('inv_1')),
            near: Inventory.shelf(pick('inv_2')),
            over: Inventory.shelf(pick('inv_3')),
            restock2: Inventory.needRestock(pick('inv_2')),
            restock1: Inventory.needRestock(pick('inv_1'))
          };
        """)
        check("保质期充足标为正常", shelf["far"]["cls"] == "badge--ok", shelf["far"]["text"])
        check("7 天内到期重点提醒", shelf["near"]["cls"] == "badge--risk", shelf["near"]["text"])
        check("已过期正确识别", "已过期" in shelf["over"]["text"], shelf["over"]["text"])
        check("低于阈值判定为待补货", shelf["restock2"] is True and shelf["restock1"] is False)

        cdp.goto(BASE_URL + "#/inventory")
        cdp.wait_for("document.querySelectorAll('[data-panel] .row-card').length===3",
                     "库存列表")
        first = cdp.eval("return document.querySelector('[data-panel] .item-name').textContent;")
        check("临期商品排在最前", first in ("酸奶", "牛奶"), first)

        cdp.eval("""
          var chips = Array.from(document.querySelectorAll('[data-view] .chip[data-v]'));
          chips.filter(function(c){return c.dataset.v==='restock'})[0].click();
          return true;
        """)
        check("待补货筛选生效", bool(cdp.wait_for(
            "document.querySelectorAll('[data-panel] .row-card').length===1", "待补货")))
        cdp.eval("""
          var chips = Array.from(document.querySelectorAll('[data-view] .chip[data-v]'));
          chips.filter(function(c){return c.dataset.v==='all'})[0].click();
          return true;
        """)
        cdp.wait_for("document.querySelectorAll('[data-panel] .row-card').length===3", "复原")

        consumed = cdp.eval("""
          var rows = await Inventory.list();
          var item = rows.filter(function(r){return r.id==='inv_1'})[0];
          await Inventory.consume(item, 3, '客厅用掉');
          var fresh = await Store.get(Store.S.inventory, 'inv_1');
          return {qty: fresh.qty, logs: fresh.consumes.length,
                  note: fresh.consumes[0].note, restock: Inventory.needRestock(fresh)};
        """)
        check("登记消耗后扣减库存", consumed["qty"] == 5, f"8 → {consumed['qty']}")
        check("消耗流水已记录", consumed["logs"] == 1 and consumed["note"] == "客厅用掉")

        step = cdp.eval("""
          var cards = Array.from(document.querySelectorAll('[data-panel] .row-card'));
          var target = cards.filter(function(c){
            return c.querySelector('.item-name').textContent === '抽纸 3层';
          })[0];
          target.querySelector('[data-plus]').click();
          return true;
        """)
        time.sleep(0.6)
        after = cdp.eval("return (await Store.get(Store.S.inventory,'inv_1')).qty;")
        check("步进器可直接加库存", after == 6, f"5 → {after}")

        # ============ 事件记录本 ============
        print("\n▸ 事件记录本：随手一记")
        cdp.eval(MAKE_IMG + """
          var ph = await mkPhoto();
          await Store.put(Store.S.notes, {
            id: 'note_1', title: '装修灵感', body: '客厅想做无主灯',
            images: [ph], createdAt: Date.now(), updatedAt: Date.now()
          });
          await Store.put(Store.S.notes, {
            id: 'note_2', title: '', body: '记得周五还书',
            images: [], createdAt: Date.now()-1, updatedAt: Date.now()
          });
          return true;
        """)
        cdp.goto(BASE_URL + "#/events/notes")
        cdp.wait_for("document.querySelectorAll('[data-panel] .row-card').length===2",
                     "笔记列表")
        ntxt = cdp.eval("return document.querySelector('[data-panel]').textContent;")
        check("笔记列表渲染", "装修灵感" in ntxt and "记得周五还书" in ntxt)
        check("无标题笔记用正文摘要", "记得周五还书" in ntxt)
        check("显示配图数量", "1 张图" in ntxt)

        print("\n▸ 事件记录本：重大事件")
        cdp.eval(MAKE_IMG + """
          var cover = await mkPhoto();
          await Store.put(Store.S.projects, {
            id: 'proj_1', name: '2027 春季婚礼', category: '婚礼筹备',
            brief: '预算 20 万，60 人规模',
            startDate: iso(-30), dueDate: iso(90), budget: 200000,
            coverFullId: cover.fullId, coverThumbId: cover.thumbId,
            tasks: [
              {id:'t1', title:'预订场地', status:'done', due:'', note:'', createdAt:Date.now()},
              {id:'t2', title:'选婚纱', status:'doing', due:iso(20), note:'', createdAt:Date.now()},
              {id:'t3', title:'定婚礼摄影', status:'todo', due:'', note:'', createdAt:Date.now()},
              {id:'t4', title:'发喜帖', status:'todo', due:'', note:'', createdAt:Date.now()}
            ],
            expenses: [
              {id:'e1', name:'场地定金', amount:50000, date:iso(-20), category:'场地', note:'', createdAt:Date.now()},
              {id:'e2', name:'婚纱租赁', amount:12000, date:iso(-5), category:'服装', note:'', createdAt:Date.now()}
            ],
            logs: [{id:'l1', date:iso(-10), content:'与策划沟通流程', createdAt:Date.now()}],
            attachments: [],
            createdAt: Date.now(), updatedAt: Date.now()
          });
          return true;
        """)

        derived = cdp.eval("""
          var p = await Store.get(Store.S.projects, 'proj_1');
          return {prog: Events.progress(p), bud: Events.budget(p), dl: Events.deadline(p)};
        """)
        check("任务完成率按状态计算",
              derived["prog"]["pct"] == 25 and derived["prog"]["done"] == 1,
              f"{derived['prog']['done']}/{derived['prog']['total']} = {derived['prog']['pct']}%")
        check("预算已花费自动汇总", derived["bud"]["spent"] == 62000,
              f"已花 {derived['bud']['spent']}")
        check("剩余预算正确", derived["bud"]["left"] == 138000,
              f"剩余 {derived['bud']['left']}")
        check("未超预算不误报", derived["bud"]["over"] is False)
        check("截止日期倒计时", "90" in derived["dl"]["text"], derived["dl"]["text"])

        cdp.goto(BASE_URL + "#/events/projects")
        cdp.wait_for("!!document.querySelector('[data-panel] .row-card')", "项目列表")
        ptxt = cdp.eval("return document.querySelector('[data-panel]').textContent;")
        check("项目卡片显示进度与预算", "1/4" in ptxt and "婚礼筹备" in ptxt)

        cdp.eval("document.querySelector('[data-open]').click(); return true;")
        cdp.wait_for("!!document.querySelector('[data-add-task]')", "项目详情打开")
        dtxt = cdp.eval("return document.body.textContent;")
        check("详情页四个区块齐全",
              all(k in dtxt for k in ['任务清单', '预算管理', '素材附件', '日志备注']))
        check("详情页显示支出明细", "场地定金" in dtxt and "婚纱租赁" in dtxt)
        check("详情页显示日志", "与策划沟通流程" in dtxt)

        toggled = cdp.eval("""
          var rows = document.querySelectorAll('.task-row');
          rows[2].querySelector('[data-toggle]').click();
          return true;
        """)
        time.sleep(0.7)
        prog2 = cdp.eval("""
          var p = await Store.get(Store.S.projects, 'proj_1');
          return Events.progress(p);
        """)
        check("点击可推进任务状态并刷新进度", prog2["pct"] == 25,
              f"待办→进行中，完成数仍为 {prog2['done']}")

        cdp.eval("""
          var rows = document.querySelectorAll('.task-row');
          var dot = rows[2].querySelector('[data-toggle]');
          dot.click();
          return true;
        """)
        time.sleep(0.7)
        prog3 = cdp.eval("""
          var p = await Store.get(Store.S.projects, 'proj_1');
          return Events.progress(p);
        """)
        check("再点一次标记完成，进度上升", prog3["pct"] == 50,
              f"{prog3['done']}/{prog3['total']} = {prog3['pct']}%")

        print("\n▸ 项目详情返回列表")
        hash_now = cdp.eval("return location.hash;")
        check("详情页有独立 hash", hash_now.startswith("#/events/projects/"), hash_now)

        cdp.eval("document.querySelector('[data-back]').click(); return true;")
        back_ok = True
        try:
            cdp.wait_for(
                "!!document.querySelector('[data-panel] .row-card') && "
                "!document.querySelector('[data-add-task]')",
                "返回项目列表", timeout=12)
        except AssertionError:
            back_ok = False
        check("点返回能回到项目列表", back_ok,
              cdp.eval("return location.hash;"))

        # 直达详情 hash（等价于刷新后恢复）
        cdp.goto(BASE_URL + "#/events/projects/proj_1")
        direct = True
        try:
            cdp.wait_for("!!document.querySelector('[data-add-task]')",
                         "hash 直达详情", timeout=12)
        except AssertionError:
            direct = False
        check("hash 可直达项目详情", direct)

        cdp.eval("history.back(); return true;")
        sys_back = True
        try:
            cdp.wait_for("!!document.querySelector('[data-panel] .row-card')",
                         "系统返回键", timeout=12)
        except AssertionError:
            sys_back = False
        check("浏览器/系统返回键可用", sys_back,
              cdp.eval("return location.hash;"))

        # 回到详情页继续后面的断言
        cdp.goto(BASE_URL + "#/events/projects/proj_1")
        cdp.wait_for("!!document.querySelector('[data-add-task]')", "详情页")

        missing = cdp.eval("""
          location.hash = '#/events/projects/not_exist_id';
          return true;
        """)
        fallback = True
        try:
            cdp.wait_for("location.hash === '#/events/projects'",
                         "不存在的项目退回列表", timeout=12)
        except AssertionError:
            fallback = False
        check("打开不存在的项目会退回列表", fallback,
              cdp.eval("return location.hash;"))

        cdp.goto(BASE_URL + "#/events/projects/proj_1")
        cdp.wait_for("!!document.querySelector('[data-add-task]')", "详情页")

        over = cdp.eval(MAKE_IMG + """
          var p = await Store.get(Store.S.projects, 'proj_1');
          p.expenses.push({id:'e3', name:'超支测试', amount:200000,
            date:iso(0), category:'', note:'', createdAt:Date.now()});
          await Store.put(Store.S.projects, p);
          var b = Events.budget(p);
          p.expenses = p.expenses.filter(function(x){return x.id!=='e3'});
          await Store.put(Store.S.projects, p);
          return b;
        """)
        check("超预算能被识别", over["over"] is True and over["left"] < 0,
              f"剩余 {over['left']}")

        # ============ 备份与恢复 ============
        print("\n▸ 备份导出")
        exported = cdp.eval("""
          var res = await Backup.exportAll(function(){});
          window.__backup = res.blob;
          return {
            size: res.blob.size, type: res.blob.type,
            counts: res.manifest.counts, blobCount: res.manifest.blobCount,
            app: res.manifest.app, schema: res.manifest.schemaVersion
          };
        """, timeout_ms=90000)
        check("导出为 ZIP", exported["type"] == "application/zip",
              f"{exported['size']} B")
        check("清单记录各模块条数",
              exported["counts"]["devices"] == 2 and
              exported["counts"]["inventory"] == 3 and
              exported["counts"]["notes"] == 2 and
              exported["counts"]["projects"] == 1,
              str(exported["counts"]))
        check("图片一并打包", exported["blobCount"] >= 6,
              f"{exported['blobCount']} 个")

        zipok = cdp.eval("""
          var files = await Backup._readZip(window.__backup);
          var names = Object.keys(files);
          return {
            hasManifest: names.indexOf('manifest.json') > -1,
            hasData: names.indexOf('data.json') > -1,
            blobFiles: names.filter(function(n){return n.indexOf('blobs/')===0}).length,
            total: names.length
          };
        """)
        check("ZIP 结构正确可被解析",
              zipok["hasManifest"] and zipok["hasData"] and zipok["blobFiles"] > 0,
              f"{zipok['total']} 个条目，其中图片 {zipok['blobFiles']}")

        print("\n▸ 恢复：清空后从备份还原")
        cleared = cdp.eval("""
          Img.releaseAll();
          var names = Store.businessStores();
          for (var i=0;i<names.length;i++){ await Store.purgeStore(names[i]); }
          var left = 0;
          for (var j=0;j<names.length;j++){ left += await Store.count(names[j]); }
          return {left: left, blobs: await Store.count(Store.S.blobs)};
        """)
        check("清空后数据为零", cleared["left"] == 0, f"剩 {cleared['left']} 条")

        restored = cdp.eval("""
          var file = new File([window.__backup], 'b.zip', {type:'application/zip'});
          var info = await Backup.inspect(file);
          var written = await Backup.restore(info.payload, 'replace');
          var out = {};
          var names = Store.businessStores();
          for (var i=0;i<names.length;i++){ out[names[i]] = await Store.count(names[i]); }
          return {written: written, counts: out, blobs: await Store.count(Store.S.blobs),
                  summary: info.summary, missing: info.missing.length};
        """, timeout_ms=90000)
        check("导入无缺失文件", restored["missing"] == 0)
        check("记录数完整还原",
              restored["counts"]["devices"] == 2 and
              restored["counts"]["inventory"] == 3 and
              restored["counts"]["notes"] == 2 and
              restored["counts"]["projects"] == 1,
              str(restored["counts"]))
        check("图片一并还原", restored["blobs"] >= 6, f"{restored['blobs']} 个")

        deep = cdp.eval("""
          var p = await Store.get(Store.S.projects, 'proj_1');
          var d = await Store.get(Store.S.devices, 'dev_test_1');
          var inv = await Store.get(Store.S.inventory, 'inv_1');
          var blob = await Store.getBlob(d.photos[0].fullId);
          return {
            tasks: p.tasks.length, expenses: p.expenses.length, logs: p.logs.length,
            budget: Events.budget(p).spent,
            devName: d.name, usedDays: Devices.usedDays(d),
            invQty: inv.qty, invLogs: (inv.consumes||[]).length,
            photoOk: !!blob && blob.size > 0
          };
        """)
        check("项目子数据完整（任务/支出/日志）",
              deep["tasks"] == 4 and deep["expenses"] == 2 and deep["logs"] == 1,
              f"{deep['tasks']} 任务 / {deep['expenses']} 支出 / {deep['logs']} 日志")
        check("预算统计恢复后一致", deep["budget"] == 62000, f"{deep['budget']}")
        check("设备日期计算恢复后仍正确", deep["usedDays"] == 400, f"{deep['usedDays']} 天")
        check("库存数量与消耗流水恢复", deep["invQty"] == 6 and deep["invLogs"] == 1,
              f"{deep['invQty']} 包 / {deep['invLogs']} 条流水")
        check("照片二进制可正常读回", deep["photoOk"] is True)

        print("\n▸ 导入容错")
        bad = cdp.eval("""
          try {
            var f = new File([new Uint8Array([1,2,3,4,5])], 'x.zip', {type:'application/zip'});
            await Backup.inspect(f);
            return 'no-error';
          } catch (e) { return e.message; }
        """)
        check("非法文件被拒绝且有可读提示", "ZIP" in bad or "备份" in bad, bad)

        intact = cdp.eval("""
          var before = await Store.count(Store.S.devices);
          try {
            await Backup.restore({records: {devices: [{noId: true}]}, blobs: []}, 'merge');
          } catch (e) { /* 预期可能失败 */ }
          return {before: before, after: await Store.count(Store.S.devices)};
        """)
        check("异常导入不破坏现有数据",
              intact["after"] == intact["before"],
              f"{intact['before']} → {intact['after']}")

        print("\n▸ 首页统计接入")
        cdp.goto(BASE_URL + "#/")
        cdp.wait_for("document.querySelectorAll('.tool-card').length===4", "首页卡片")
        metas = cdp.eval("""
          return Array.from(document.querySelectorAll('.tool-card')).map(function(c){
            return {
              title: c.querySelector('.tool-title').textContent,
              meta: c.querySelector('.tool-meta').textContent,
              disabled: c.getAttribute('aria-disabled')
            };
          });
        """)
        check("四张卡片都已启用",
              all(m["disabled"] != "true" for m in metas),
              str([m["disabled"] for m in metas]))
        by = {m["title"]: m["meta"] for m in metas}
        check("设备卡显示真实台数", "2 台设备" in by.get("电子物品档案", ""),
              by.get("电子物品档案"))
        check("库存卡显示临期与待补",
              "3 项库存" in by.get("生活用品库存", ""), by.get("生活用品库存"))
        check("事件卡显示笔记与进行中项目",
              "2 条笔记" in by.get("事件记录本", ""), by.get("事件记录本"))

        print("\n▸ 路由可达性")
        for path, sel, label in [
            ("#/devices", "[data-panel] .row-card", "电子物品档案"),
            ("#/inventory", "[data-panel] .row-card", "生活用品库存"),
            ("#/events/notes", "[data-panel] .row-card", "随手一记"),
            ("#/events/projects", "[data-panel] .row-card", "重大事件"),
            ("#/settings", "[data-export]", "数据与存储"),
        ]:
            cdp.goto(BASE_URL + path)
            ok = True
            try:
                cdp.wait_for(f"!!document.querySelector('{sel}')", label, timeout=12)
            except AssertionError:
                ok = False
            check(f"{label} 页面可打开", ok, path)

        fab = cdp.eval("""
          location.hash = '#/devices';
          return true;
        """)
        cdp.wait_for("!!document.querySelector('.fab')", "悬浮按钮")
        check("模块页有悬浮新增按钮", True,
              cdp.eval("return document.querySelector('.fab').textContent.trim();"))

        errs = [l for l in cdp.logs if "pageerror" in l]
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
    for f in FAIL:
        print("  · " + f)
    print("=" * 56)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
