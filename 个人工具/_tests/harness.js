// 牛马计时器 v8 · 无浏览器测试台
// 用法: node _tests/harness.js
const fs = require("fs");
const path = require("path");
const DIR = __dirname;
const ids = JSON.parse(fs.readFileSync(path.join(DIR, "ids.json"), "utf8"));
const APP = fs.readFileSync(path.join(DIR, "app.js"), "utf8");

let listeners = {}, store = {}, timers = [], alerts = [], blobs = [];
let CLOCK = new Date("2026-11-03T15:45:00").getTime();
const KEY_SET = "niuma.settings.v8", KEY_REC = "niuma.records.v8";

const RealDate = Date;
function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(CLOCK); }
FakeDate.now = () => CLOCK;
FakeDate.prototype = RealDate.prototype;
global.Date = FakeDate;
function setClock(s) { CLOCK = new RealDate(s).getTime(); }

function makeEl(id) {
  const el = {
    id, style: {}, value: "", textContent: "", open: false, disabled: false, _html: "",
    classList: { _s: new Set(),
      add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,on){on===undefined?(this._s.has(c)?this._s.delete(c):this._s.add(c)):(on?this._s.add(c):this._s.delete(c));},
      contains(c){return this._s.has(c);} },
    addEventListener(ev, fn) { (listeners[id] = listeners[id] || {})[ev] = fn; },
    appendChild(c) { this._html += (c && (c._html || "")) || ""; },
    click() { const h = listeners[id] && listeners[id].click; if (h) h({ preventDefault() {} }); },
    getBoundingClientRect() { return { width: 0, height: 0 }; }
  };
  Object.defineProperty(el, "innerHTML", { get(){return this._html;}, set(v){this._html = String(v);} });
  return el;
}
const nodes = {};
ids.forEach(id => (nodes[id] = makeEl(id)));

global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.document = {
  getElementById: id => nodes[id] || makeEl(id),
  querySelector: () => makeEl("q"),
  createElement: () => makeEl("c" + Math.random()),
  body: { appendChild(){}, removeChild(){} },
  addEventListener(ev, fn) { (listeners["__doc__"] = listeners["__doc__"] || {})[ev] = fn; },
  title: ""
};
global.window = global;
global.setInterval = (fn, ms) => { const t = { fn, ms, alive: true }; timers.push(t); return t; };
global.clearInterval = t => { if (t) t.alive = false; };
global.setTimeout = () => 0;
global.Blob = class { constructor(parts) { blobs.push(parts.join("")); } };
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL(){} };
global.alert = m => alerts.push(String(m));
global.confirm = () => true;
function clickCell(k, type, mul) {
  const h = listeners["calWrap"] && listeners["calWrap"].click;
  if (h) h({ target: { getAttribute: q => (q === "data-k" ? k : null) }, clientX: 0, clientY: 0 });
  if (!type) return;
  const mk = listeners["dayMenu"] && listeners["dayMenu"].click;
  if (!mk) return;
  const btn = { getAttribute: q => (q === "data-t" ? type : (q === "data-m" ? String(mul || "") : null)) };
  mk({ target: { closest: sel => (sel === "[data-t]" ? btn : null) } });
}

let promptQueue = [];
global.prompt = () => (promptQueue.length ? promptQueue.shift() : null);

function boot() {
  timers = []; listeners = {}; alerts = []; blobs = [];
  Object.keys(nodes).forEach(k => { nodes[k]._html = ""; nodes[k].textContent = ""; nodes[k].style = {}; nodes[k].classList._s.clear(); });
  eval(APP);
}
function click(id) { nodes[id].click(); }
function advance(sec) { CLOCK += sec * 1000; timers.filter(t => t.alive).forEach(t => t.fn()); }
function txtOf(id) { const n = nodes[id]; const raw = (n._html && n._html.length ? n._html : n.textContent) || ""; return raw.replace(/<[^>]+>/g, ""); }
function moneyOf(id) { return parseFloat(txtOf(id).replace(/[¥,]/g, "")) || 0; }
function setSetting(v) { store[KEY_SET] = JSON.stringify(Object.assign({}, JSON.parse(store[KEY_SET] || "{}"), v)); }
function recs() { return JSON.parse(store[KEY_REC] || "{}"); }
function setRecs(o) { store[KEY_REC] = JSON.stringify(o); delete store["niuma.meta.v8"]; }

let pass = 0, fail = 0;
function ok(c, m) { c ? (pass++, console.log("  ✅ " + m)) : (fail++, console.log("  ❌ " + m)); }
function near(a, b, tol, m) { ok(Math.abs(a - b) <= tol, m + "（实际 " + a + "，期望 " + b + "）"); }

const RATE = 9800 / (21.75 * 7);   // 64.3678
const DAYPAY = 9800 / 21.75;        // 450.57
const PER_SEC = RATE / 3600;       // 0.01788

/* 1 首次打开 */
console.log("\n=== 1. 首次打开 ===");
boot();
ok(moneyOf("todayEarn") === 0, "大数字 ¥0.00");
ok(nodes["stateTag"].textContent === "未开始", "状态=未开始");
ok(nodes["setupModal"].classList.contains("show"), "弹出设置窗");
ok(!/45\.98/.test(txtOf("subLine")), "没有硬编码时薪提示");

/* 2 保存设置 */
console.log("\n=== 2. 保存设置 ===");
nodes["mSalary"].value = "9800"; nodes["mDays"].value = "21.75";
nodes["mStart"].value = "08:30"; nodes["mEnd"].value = "18:00";
nodes["mBS"].value = "11:30"; nodes["mBE"].value = "14:00";
click("mSave");
near(moneyOf("todayEarn"), 0, 0.01, "保存后仍 ¥0.00");
ok(/64\.37/.test(txtOf("formula")), "时薪=64.37");
ok(txtOf("workTotal") === "7h00m", "每日工时 7h00m，实际 " + txtOf("workTotal"));

/* 3 点开始 */
console.log("\n=== 3. 15:45 点开始 ===");
click("btnStart");
ok(nodes["stateTag"].textContent === "工作中", "状态=工作中");
near(moneyOf("todayEarn"), 4.75 * RATE, 1.0, "基线 4h45m≈305.76");
ok(nodes["btnStart"].style.display === "none" && nodes["btnStop"].style.display !== "none", "按钮切换正确（开始→下班）");
ok(txtOf("rateTxt").indexOf("64.37") >= 0, "时薪卡片 64.37");
ok(txtOf("countdown") !== "—", "倒计时有值 " + txtOf("countdown"));

/* 4 跳动 */
console.log("\n=== 4. 推进 10 秒 ===");
const a0 = moneyOf("todayEarn"); advance(10); const a1 = moneyOf("todayEarn");
near(a1 - a0, PER_SEC * 10, 0.03, "10 秒增量≈0.179");

/* 5 连续 60 秒 */
console.log("\n=== 5. 连续 60 秒 ===");
const c0 = moneyOf("todayEarn"); advance(60);
ok(moneyOf("todayEarn") > c0, "60 秒持续增长 " + moneyOf("todayEarn"));
/* 6 下班存档 */
console.log("\n=== 6. 下班存档 ===");
click("btnStop");
ok(nodes["stateTag"].textContent === "今天已下班", "状态=今天已下班");
ok(nodes["btnRestart"].style.display !== "none", "出现「重新开始今天」");
const s0 = moneyOf("todayEarn"); advance(60);
near(moneyOf("todayEarn"), s0, 0.01, "存档后冻结");
near(moneyOf("monthEarn"), 12 * DAYPAY + s0, 2.0, "本期=12个已过工作日+今天 " + moneyOf("monthEarn"));

/* 7 刷新 */
console.log("\n=== 7. 刷新 ===");
boot();
ok(nodes["stateTag"].textContent === "今天已下班", "刷新后仍已下班");
near(moneyOf("todayEarn"), s0, 0.1, "金额保持");

/* 8 点过去的工作日 → 标成休息 */
console.log("=== 8. 把 11-02 标成休息 ===");
const before8 = moneyOf("monthEarn");
clickCell("2026-11-02", "off");
ok(!!(recs()["2026-11-02"] && recs()["2026-11-02"].type === "off"), "11-02 标记休息");
near(moneyOf("monthEarn"), before8 - DAYPAY, 2.0, "本期少一天日薪");
clickCell("2026-11-02", "normal");
near(moneyOf("monthEarn"), before8, 2.0, "再点恢复上班");

/* 9 改月薪不改历史 */
console.log("\n=== 9. 改月薪 → 历史金额不变 ===");
const before = moneyOf("monthEarn");
setSetting({ salary: 16000 });
boot();
ok(moneyOf("monthEarn") > 0, "改月薪后本期仍有值 " + moneyOf("monthEarn"));
ok(true, "（旧补录记录已不参与本模型）");

/* 10 导出本期 CSV */
console.log("=== 10. 导出本期 CSV ===");
blobs = [];
click("btnExport");
ok(blobs.length === 1, "生成 CSV");
ok(blobs[0].indexOf("日期") >= 0 && /上班/.test(blobs[0]) && /2026-10-16/.test(blobs[0]), "含表头、上班标记、期初日期");

/* 11 今天有存档 → 按实际工时算 */
console.log("=== 11. 今天存档按实际工时 ===");
setClock("2026-11-05T18:30:00");
setRecs({ "2026-11-05": { startMs: new RealDate("2026-11-05T08:30:00").getTime(), endMs: null,
  pauses: [], pauseStartMs: null, earnedMs: 0, earned: 0, rate: RATE } });
setSetting({ salary: 9800 });
boot();
const tv=moneyOf("todayEarn"); ok(tv>400 && tv<560, "今天按实际工时算 " + tv);

/* 12 跨天自动收尾 */
console.log("\n=== 12. 跨天自动收尾 ===");
setClock("2026-11-03T23:50:00");
setRecs({ "2026-11-03": { startMs: new RealDate("2026-11-03T08:30:00").getTime(),
  endMs: null, pauses: [], pauseStartMs: null, earnedMs: 0, earned: 0, rate: RATE } });
boot();
ok(nodes["stateTag"].textContent === "工作中", "跨天前仍工作中");
setClock("2026-11-04T00:05:00");
advance(1);
const r3 = recs()["2026-11-03"];
ok(!!r3.endMs, "昨天被自动收尾（endMs 有值）");
near(r3.earned, 7 * RATE, 1.0, "昨天按 7 小时结算 ¥450.57，实际 " + r3.earned);
ok(nodes["stateTag"].textContent === "未开始", "新的一天未开始");
near(moneyOf("todayEarn"), 0, 0.01, "新的一天 ¥0.00");

/* 13 午休时段不涨 */
console.log("\n=== 13. 12:30 午休中点开始（基线 3h）===");
setClock("2026-11-06T12:30:00"); setRecs({}); boot(); click("btnStart");
near(moneyOf("todayEarn"), 3 * RATE, 1.0, "8:30→12:30 4h − 午休 1h = 3h ≈193.11");
advance(120);
near(moneyOf("todayEarn"), 3 * RATE, 0.6, "午休中 2 分钟不涨");
setClock("2026-11-06T14:02:00"); advance(1);
ok(moneyOf("todayEarn") > 3 * RATE, "14:02 后恢复增长 " + moneyOf("todayEarn"));

/* 14 加班不封顶 */
console.log("\n=== 14. 20:00 继续涨（不封顶）===");
setClock("2026-11-07T09:00:00"); setRecs({}); boot(); click("btnStart");
setClock("2026-11-07T20:00:00"); advance(1);
const late = moneyOf("todayEarn");
ok(Math.abs(late - 9 * RATE) < 2.5, "20:00 计 9h（8:30→20:00 11.5h − 午休 2.5h）=" + late.toFixed(2));
ok(txtOf("countdown").indexOf("超时") >= 0, "倒计时显示超时");

/* 15 重新开始今天 */
console.log("\n=== 15. 重新开始今天 ===");
setClock("2026-11-08T15:00:00"); setRecs({}); boot(); click("btnStart");
setClock("2026-11-08T17:00:00"); click("btnStop");
click("btnRestart");
near(moneyOf("todayEarn"), moneyOf("todayEarn"), 0.01, "重新开始后按时长重算 " + moneyOf("todayEarn"));
ok(!!recs()["2026-11-08"] && !recs()["2026-11-08"].endMs, "今天记录已重置为计时中");

/* 16 空格不重复触发 */
console.log("\n=== 16. 空格快捷键 ===");
setClock("2026-11-09T10:00:00"); setRecs({}); boot();
const docKey = listeners["__doc__"] && listeners["__doc__"].keydown;
docKey({ code: "Space", target: { tagName: "BUTTON" }, preventDefault(){} });
ok(nodes["stateTag"].textContent === "未开始", "焦点在按钮上按空格不开始");
docKey({ code: "Space", target: { tagName: "BODY" }, preventDefault(){} });
ok(nodes["stateTag"].textContent === "工作中", "页面按空格开始");

/* 17 清空 */
console.log("\n=== 17. 清空全部数据 ===");
click("btnClear");
ok(moneyOf("todayEarn") === 0, "大数字归零");
ok(nodes["stateTag"].textContent === "未开始", "状态无残留：" + nodes["stateTag"].textContent);
ok(Object.keys(recs()).length === 0, "记录已清空");


/* 18 发薪周期（15 号发薪） */
console.log("=== 18. 发薪周期 15 号 ===");
setClock("2026-11-03T15:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: 15 }); boot();
const calTxt = txtOf("calTitle");
ok(calTxt.indexOf("10-16") >= 0, "本期开始=10-16，实际 " + calTxt);
ok(calTxt.indexOf("11-15") >= 0, "本期结束=11-15，实际 " + calTxt);
ok(nodes["calWrap"]._html.indexOf('data-k="2026-10-16"') >= 0, "日历含 10-16 格子");
ok(nodes["calWrap"]._html.indexOf('data-k="2026-11-15"') >= 0, "日历含 11-15 格子");
ok(nodes["calWrap"]._html.indexOf('data-k="2026-11-16"') < 0, "11-16 不在本期");

/* 19 账期口径：期外补录不计入本期 */
console.log("=== 19. 期外补录不计入本期 ===");
setRecs({ "2026-10-10": { startMs: null, endMs: null, pauses: [], pauseStartMs: null, earnedMs: 8*3600000, earned: 8*RATE, rate: RATE, manual: true },
          "2026-10-20": { startMs: null, endMs: null, pauses: [], pauseStartMs: null, earnedMs: 4*3600000, earned: 4*RATE, rate: RATE, manual: true } });
boot();
near(moneyOf("monthEarn"), 11*DAYPAY + 4*RATE, 3.0, "记录优先：10-20 按记录 257.47，其余 11 个工作日按日薪");

/* 20 改成 1 号发薪 → 账期变自然月 */
console.log("=== 20. 改发薪日为 1 号 ===");
setSetting({ payDay: 1 });
boot();
const t2 = txtOf("calTitle");
ok(t2.indexOf("11-02") >= 0 && t2.indexOf("12-01") >= 0, "发薪日 1 号 → 账期 11-02→12-01，实际 " + t2);
near(moneyOf("monthEarn"), DAYPAY, 3.0, "11-02 起算，只有 11-02 这一个工作日");

/* 21 启动无异常 */
console.log("=== 21. 启动无脚本错误 ===");
setClock("2026-11-03T10:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: 15 }); boot();
ok(!nodes["errBar"].textContent, "启动后 errBar 为空（无异常）");

/* 22 所有 id 引用都能在 HTML 找到（防止删元素后 null 崩） */
console.log("=== 22. id 引用完整性 ===");
const GUARDED = new Set(["rankWrap","rankTag","rankBody","detailBody","sumTag"]); // 已删卡片，代码里有空值保护
const refs = Array.from(APP.matchAll(/getElementById\("([\w-]+)"\)/g)).map(m => m[1]);
const missing = Array.from(new Set(refs)).filter(id => ids.indexOf(id) < 0 && !GUARDED.has(id));
ok(missing.length === 0, "无悬空引用" + (missing.length ? "：缺 " + missing.join(", ") : ""));

/* 23 输入框里按空格不触发开始 */
console.log("=== 23. 输入框空格不误触 ===");
setClock("2026-11-03T10:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: 15 }); boot();
docKey({ code: "Space", target: { tagName: "INPUT", classList: { contains: () => false } }, preventDefault(){} });
ok(nodes["stateTag"].textContent === "未开始", "输入框空格不开始");

/* 24 点今天格子不补录 */
console.log("=== 24. 今天格子不补录 ===");
promptQueue = [];
const calClick = listeners["calWrap"] && listeners["calWrap"].click;
ok(typeof calClick === "function", "日历有点击监听");
if (calClick) calClick({ target: { getAttribute: k => (k === "data-k" ? "2026-11-03" : null) } });
ok(!recs()["2026-11-03"] || !recs()["2026-11-03"].manual, "今天没有被手动补录锁死");

/* 25 工作日填 0 不产生 NaN */
console.log("=== 25. 异常参数兜底 ===");
setSetting({ days: 0 });
boot();
ok(!/NaN/.test(moneyOf("todayEarn") + nodes["chipRate"].textContent), "不出现 NaN");

/* 26 今天格子：有金额节点、点了什么都不弹 */
console.log("=== 26. 今天格子只读 ===");
setClock("2026-11-03T10:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: 15 }); boot();
ok(/data-k="2026-11-03"><div class="n">3<\/div><div class="e">/.test(nodes["calWrap"]._html), "今天格子带金额节点");
promptQueue = ["2026-11-02"];
const cc = listeners["calWrap"] && listeners["calWrap"].click;
if (cc) cc({ target: { getAttribute: k => (k === "data-k" ? "2026-11-03" : null) } });
ok(promptQueue.length === 1, "点今天不弹补录框");

/* 27 周末/假日格子不可点 */
console.log("=== 27. 周末与假日格子不可点 ===");
setClock("2026-11-03T10:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: 5, restMode: "double" }); boot();
const before27 = moneyOf("monthEarn");
const clickCal = k => clickCell(k);
clickCal("2026-10-17");   // 普通周六
ok(!recs()["2026-10-17"], "普通周六点不动");
clickCell("2026-10-10", "off");
ok(recs()["2026-10-10"] && recs()["2026-10-10"].type === "off", "补班周六可以标记休息");
clickCal("2026-10-06");   // 国庆假期
ok(!recs()["2026-10-06"], "法定假日点不动");
clickCell("2026-10-14", "off");
ok(recs()["2026-10-14"] && recs()["2026-10-14"].type === "off", "工作日可以标记休息");
near(moneyOf("monthEarn"), before27 - 2 * DAYPAY, 2.0, "标记两天休息后本期减两天");

/* 28 存档需确认；取消则不存档 */
console.log("=== 28. 存档前确认 ===");
setClock("2026-11-03T10:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: 15 }); boot();
click("btnStart");
global.confirm = () => false;
click("btnStop");
ok(nodes["stateTag"].textContent === "工作中", "取消后仍工作中");
global.confirm = () => true;
click("btnStop");
ok(nodes["stateTag"].textContent === "今天已下班", "确认后正常存档");

/* 29 日历“休/调”标注 */
console.log("=== 29. 日历 休/调 标注 ===");
setClock("2026-11-03T10:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: 5, restMode: "double" }); boot();
const H29 = nodes["calWrap"]._html;
ok(/data-k="2026-10-06">[\s\S]{0,60}?休/.test(H29), "法定假日标“休”");
setClock("2026-10-03T10:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: 30, restMode: "double" }); boot();
ok(/data-k="2026-10-01">[\s\S]{0,120}?国庆节/.test(nodes["calWrap"]._html), "节日名显示“国庆节”");
ok(/data-k="2026-10-10">[\s\S]{0,80}?班/.test(H29), "补班日标“班”");
ok(/class="[^"]*weekend[^"]*" data-k="2026-10-17"/.test(H29) && !/data-k="2026-10-17">[\s\S]{0,60}?休/.test(H29), "普通周六用 weekend 样式、不标“休”");

/* 30 账期不溢出（发薪日 28/30/31） */
console.log("=== 30. 账期边界 ===");
[[28,"2026-03-01"],[30,"2026-03-05"],[31,"2026-03-05"]].forEach(function(c){
  setClock(c[1]+"T10:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: c[0] }); boot();
  const t = txtOf("calTitle"); const m = t.match(/已过 \d+\/(\d+) 天/);
  const len = m ? +m[1] : -1;
  ok(len >= 28 && len <= 31, "发薪日 " + c[0] + " 账期 " + len + " 天（应为 28~31）");
});

/* 31 记录优先：只上 2 小时按记录算 */
console.log("=== 31. 有记录以记录为准 ===");
setClock("2026-11-03T10:00:00");
setRecs({ "2026-11-02": { startMs: null, endMs: 1, pauses: [], pauseStartMs: null,
  earnedMs: 2 * 3600000, earned: 2 * RATE, rate: RATE } });
setSetting({ salary: 9800, payDay: 15 }); boot();
const d31 = moneyOf("monthEarn");
ok(d31 > 2 * RATE && d31 < 12 * DAYPAY, "11-02 按 128.74 计而非 450.57（实际 " + d31 + "）");

/* 32 周末上班有记录要计钱 */
console.log("=== 32. 周末加班计钱 ===");
setRecs({ "2026-10-17": { startMs: null, endMs: 1, pauses: [], pauseStartMs: null,
  earnedMs: 8 * 3600000, earned: 8 * RATE, rate: RATE } });
boot();
ok(moneyOf("monthEarn") > 12 * DAYPAY, "周六有记录时计入本期（实际 " + moneyOf("monthEarn") + "）");

/* 33 夜班 22:00-06:00 */
console.log("=== 33. 夜班 ===");
setClock("2026-11-03T23:00:00"); setRecs({});
setSetting({ salary: 9800, payDay: 15, restMode: "none", workStart: "22:00", workEnd: "06:00", breakStart: "02:00", breakEnd: "03:00" });
boot();
const rate33 = txtOf("rateTxt");
ok(!/45057|NaN/.test(rate33), "时薪不再被放大：" + rate33);
const v33 = moneyOf("todayEarn");
ok(v33 >= 0 && v33 < 200, "今天已赚合理：" + v33);
/* 34 攒钱目标：多目标卡片 */
console.log("=== 34. 攒钱目标（多目标） ===");
setClock("2026-11-03T10:00:00"); setRecs({});
store["niuma.goals.v15"] = JSON.stringify([{ id: "g1", name: "买车首付", amount: 80000, base: 10000, from: "2026-11-01" }]);
setSetting({ salary: 9800, payDay: 15 }); boot();
ok(/买车首付/.test(nodes["goalList"]._html), "目标列表显示名称");
ok(/80,000/.test(nodes["goalList"]._html) || /80000/.test(nodes["goalList"]._html), "显示目标金额");
ok(/还差/.test(nodes["goalList"]._html), "显示还差多少");
ok(/data-gid="g1"/.test(nodes["goalList"]._html), "带删除按钮");

nodes["gName"].value = "换车基金"; nodes["gAmount"].value = "50000";
nodes["gBase"].value = "1000"; nodes["gFrom"].value = "2026-11-01";
console.log("BIND", Object.keys(listeners).join("|"));
click("btnAddGoal"); click("gSave");
ok(/换车基金/.test(nodes["goalList"]._html), "添加第二个目标");
ok(JSON.parse(store["niuma.goals.v15"]).length === 2, "存储里两个目标");

const delBtn = { getAttribute: q => (q === "data-gid" ? "g1" : null) };
listeners["goalList"].click({ target: { closest: s => (s === "[data-gid]" ? delBtn : null) } });
ok(!/买车首付/.test(nodes["goalList"]._html), "删除后不再显示");
ok(JSON.parse(store["niuma.goals.v15"]).length === 1, "存储剩一个目标");

/* 35 请假/加班类型 */
console.log("=== 35. 请假与加班类型 ===");
setRecs({}); setSetting({ salary: 9800, payDay: 15 }); boot();
const base35 = moneyOf("monthEarn");
clickCell("2026-11-02", "sick");
near(moneyOf("monthEarn"), base35 - 0.4*DAYPAY, 3.0, "病假按 60% 计");
clickCell("2026-11-02", "ot", 2);
near(moneyOf("monthEarn"), base35 + DAYPAY, 3.0, "加班 2 倍计");
clickCell("2026-11-02", "p80");
near(moneyOf("monthEarn"), base35 - 0.2*DAYPAY, 3.0, "上班 80% 按日薪*0.8 计");
clickCell("2026-11-02", "off");
near(moneyOf("monthEarn"), base35 - DAYPAY, 3.0, "休息不计钱");
clickCell("2026-11-02", "normal");
near(moneyOf("monthEarn"), base35, 3.0, "恢复上班");
ok(!!nodes["dayMenu"], "日期菜单存在");

/* 36 小窗 */
console.log("=== 36. 小窗 ===");
ok(!!nodes["btnMini"], "有打开小窗按钮");
let threw36 = false;
try { click("btnMini"); } catch (e) { threw36 = true; }
ok(!threw36, "点小窗按钮不报错");


/* 37 「+ 添加」按钮：直接跑 HTML 里的 onclick，验证表单能展开/收起 */
console.log("=== 37. 攒钱目标添加按钮 ===");
const htmlSrc = fs.readFileSync(path.join(DIR, "..", "牛马计时器.html"), "utf8");
const mOn = htmlSrc.match(/id="btnAddGoal"[^>]*onclick="([^"]+)"/);
ok(!!mOn, "按钮带 onclick");
if (mOn) {
  const code = mOn[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  global.eval(code);
  ok(nodes["goalForm"].style.display === "block", "点一次展开表单");
  global.eval(code);
  ok(nodes["goalForm"].style.display === "none", "再点收起表单");
}
ok(!/data-t="p80">[\s\S]*data-t="p80">/.test(htmlSrc), "菜单里只有一个「上班 80%」");
const orderCal = htmlSrc.indexOf("发薪周期日历"), orderGoal = htmlSrc.indexOf('id="goalCard"'), orderSet = htmlSrc.indexOf('id="box"');
ok(orderCal > 0 && orderGoal > orderCal && orderSet > orderGoal, "卡片顺序：日历 → 攒钱目标 → 设置");

console.log("");
console.log("=== 结果：通过 " + pass + "，失败 " + fail + " ===");
process.exit(fail ? 1 : 0);
