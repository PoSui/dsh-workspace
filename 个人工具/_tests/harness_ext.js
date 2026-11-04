// 牛马计时器 · 扩展回归台（只读被测页面，不 require 被测代码）
// 用法: node _tests/harness_ext.js [HTML路径]
// 默认被测文件: ../牛马计时器_v11.html（可用 argv[2] 或环境变量 NI UMA_HTML 覆盖）
// 边界: 本文件不读写 _tests/harness.js、app.js、ids.json、review_v9.md，也不改任何 HTML。
//
// 设计口径（Lead 2026-11-03 拍板）：
//   有记录的日子 → 以记录为准（R[k].earned）
//   无记录的工作日 → 标准日薪
//   无记录的周末/节假日 → 0
//   标记 off → 0
// 另含账期 clamp、夜班 paidHours/跨天、2027 假期表、清空归零、写盘频率、向导后日历重绘、
// 继续计时不吞离开时间等回归断言。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ---------------- 被测代码 ---------------- */
function locateHtml() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  if (process.env.NIUMA_HTML) return path.resolve(process.env.NIUMA_HTML);
  const dir = path.join(__dirname, "..");
  const files = fs.readdirSync(dir).filter(f => /^牛马计时器.*\.html$/.test(f));
  if (!files.length) throw new Error("找不到被测 HTML");
  // 优先版本号最大的 牛马计时器_vN.html，其次按修改时间取最新
  const ver = files
    .map(f => ({ f, v: parseInt((f.match(/_v(\d+)\.html$/) || [])[1], 10) }))
    .filter(x => !isNaN(x.v))
    .sort((a, b) => b.v - a.v);
  if (ver.length) return path.join(dir, ver[0].f);
  const newest = files
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return path.join(dir, newest[0].f);
}
const HTML_PATH = locateHtml();
const HTML = fs.readFileSync(HTML_PATH, "utf8");
const SCRIPT = (HTML.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
if (!SCRIPT) throw new Error("HTML 里没有找到 <script>");
const HTML_BYTES = Buffer.byteLength(HTML);
const HTML_SHA = crypto.createHash("sha256").update(HTML).digest("hex");
const IDS = [...new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))];

/* ---------------- DOM/时钟桩（从 harness.js 抄改，不 require） ---------------- */
let listeners = {}, store = {}, timers = [], alerts = [], blobs = [], writes = 0, confirms = 0;
let CLOCK = new Date("2026-11-03T15:45:00").getTime();
const KEY_SET = "niuma.settings.v8", KEY_REC = "niuma.records.v8";
const RealDate = Date;
function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(CLOCK); }
FakeDate.now = () => CLOCK;
FakeDate.prototype = RealDate.prototype;
global.Date = FakeDate;

function makeEl(id) {
  const el = {
    id, style: {}, value: "", textContent: "", open: false, disabled: false, _html: "",
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (on ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(ev, fn) { (listeners[this.id] = listeners[this.id] || {})[ev] = fn; },
    appendChild(c) { this._html += (c && (c._html || "")) || ""; },
    click() { const h = listeners[this.id] && listeners[this.id].click; if (h) h({ preventDefault() {} }); },
    getBoundingClientRect() { return { width: 0, height: 0 }; }
  };
  Object.defineProperty(el, "innerHTML", { get() { return this._html; }, set(v) { this._html = String(v); } });
  return el;
}
const nodes = {};
IDS.forEach(id => (nodes[id] = makeEl(id)));

global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { writes++; store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.document = {
  getElementById: id => nodes[id] || makeEl(id),
  querySelector: () => makeEl("q"),
  createElement: () => makeEl("c" + Math.random()),
  body: { appendChild() {}, removeChild() {} },
  addEventListener(ev, fn) { (listeners["__doc__"] = listeners["__doc__"] || {})[ev] = fn; },
  title: ""
};
global.window = global;
global.setInterval = (fn, ms) => { const t = { fn, ms, alive: true }; timers.push(t); return t; };
global.clearInterval = t => { if (t) t.alive = false; };
global.setTimeout = () => 0;
global.Blob = class { constructor(parts) { blobs.push(parts.join("")); } };
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
global.alert = m => alerts.push(String(m));
global.confirm = () => { confirms++; return true; };
let promptQueue = [];
global.prompt = () => (promptQueue.length ? promptQueue.shift() : null);

function boot() {
  timers = []; listeners = {}; alerts = []; blobs = []; writes = 0; confirms = 0;
  Object.keys(nodes).forEach(k => {
    nodes[k]._html = ""; nodes[k].textContent = ""; nodes[k].style = {};
    nodes[k].classList._s.clear(); nodes[k].value = "";
  });
  eval(SCRIPT);
}
function setClock(s) { CLOCK = new RealDate(s).getTime(); }
function click(id) { const n = nodes[id]; if (!n) throw new Error("没有这个节点: " + id); n.click(); }
function advance(sec) { CLOCK += sec * 1000; timers.filter(t => t.alive).forEach(t => t.fn()); }
function txtOf(id) {
  const n = nodes[id];
  const raw = (n._html && n._html.length ? n._html : n.textContent) || "";
  return raw.replace(/<[^>]+>/g, "");
}
function recs() { return JSON.parse(store[KEY_REC] || "{}"); }

/** 清空 store + 设定时钟并 boot；settings/records 为 null 表示不写存储（用 DEFAULT / 空记录） */
function fresh(clockStr, settings, records) {
  store = {}; promptQueue = [];
  if (settings) store[KEY_SET] = JSON.stringify(settings);
  if (records) store[KEY_REC] = JSON.stringify(records);
  setClock(clockStr);
  boot();
}

/* ---------------- 断言与统计 ---------------- */
let pass = 0, fail = 0;
function passLine(name) { pass++; console.log("  ✅ " + name); }
function failLine(name, scenario, expected, actual) {
  fail++;
  console.log("  ❌ " + name);
  console.log("     场景：" + scenario);
  console.log("     期望：" + expected);
  console.log("     实测：" + actual);
}
function eq(name, scenario, actual, expected) {
  actual === expected ? passLine(name) : failLine(name, scenario, JSON.stringify(expected), JSON.stringify(actual));
}
function num(name, scenario, actual, expected, tol) {
  Math.abs(actual - expected) <= tol ? passLine(name) : failLine(name, scenario, expected + "（±" + tol + "）", actual);
}
function has(name, scenario, text, needle) {
  String(text).indexOf(needle) >= 0 ? passLine(name) : failLine(name, scenario, "包含 " + JSON.stringify(needle), String(text).slice(0, 160));
}
function notHas(name, scenario, text, needle) {
  String(text).indexOf(needle) < 0 ? passLine(name) : failLine(name, scenario, "不含 " + JSON.stringify(needle), String(text).slice(0, 160));
}

/* ---------------- 页面读取小工具 ---------------- */
function calTitle() { return txtOf("calTitle"); }
function sumMoney() {
  const t = txtOf("monthLabel");
  const m = t.match(/¥([\d,]+\.\d\d)/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : NaN;
}
function cellOf(k) {
  const h = nodes["calWrap"] && nodes["calWrap"]._html || "";
  const i = h.indexOf('data-k="' + k + '"');
  if (i < 0) return { cls: "", html: "" };
  const start = h.lastIndexOf('<div class="', i);
  const cls = ((h.slice(start).match(/^<div class="([^"]*)"/) || [])[1]) || "";
  const next = h.indexOf('<div class="d', i + 1);
  return { cls: cls, html: h.slice(start, next > 0 ? next : start + 400) };
}
function cellMoney(k) {
  const m = cellOf(k).html.match(/¥([\d,]+\.\d\d)/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : 0;
}
/** 读 HTML 静态文本（按钮/提示），因为桩不保存初始 HTML */
function staticTxt(id) {
  const re = new RegExp('<[a-zA-Z]+[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</[a-zA-Z]+>');
  const m = HTML.match(re);
  return m ? m[1].replace(/<[^>]+>/g, "") : "";
}
function moneyOf(id) {
  const m = txtOf(id).match(/¥([\d,]+\.\d\d)/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : NaN;
}
function csvLine(blobText, key) {
  const line = String(blobText).split(/\r?\n/).find(x => x.indexOf(key + ",") === 0);
  return line || "";
}
function fastTimer() { return timers.filter(t => t.alive && t.ms <= 300)[0]; }

/* ---------------- 固定设置 ---------------- */
const S_BASE = {
  salary: 9800, days: 21.75, hours: 7, payDay: 15, restMode: "double",
  workStart: "08:30", workEnd: "18:00", breakStart: "11:30", breakEnd: "14:00",
  mul: 1, freq: 1000
};
const RATE = 9800 / (21.75 * 7);          // 64.3678
const DAYPAY = 9800 / 21.75;              // 450.5747
const S_NIGHT = Object.assign({}, S_BASE, { workStart: "22:00", workEnd: "06:00", breakStart: "02:00", breakEnd: "02:30" });
const NIGHT_RATE = 9800 / (21.75 * 7.5);  // 60.0766，7.5h = 8h − 0.5h 夜宵

console.log("被测文件: " + HTML_PATH);
console.log("  bytes=" + HTML_BYTES + "  sha256=" + HTML_SHA);
console.log("  口径: 记录优先 → 无记录工作日=标准日薪 → 无记录周末/节假日=0 → off=0");

/* =====================================================================
 * 1. 账期边界：发薪日 28/29/30/31 不能溢出（clamp 到当月天数再 +1 天）
 * ===================================================================*/
console.log("\n=== 1. 发薪账期边界（28/29/30/31、1 号、跨年、闰年） ===");
function periodCase(label, clock, payDay, expectStartEnd, expectLen) {
  fresh(clock, Object.assign({}, S_BASE, { payDay: payDay }));
  const t = calTitle();
  has(label + " 起始日", "payDay=" + payDay + " @ " + clock.slice(0, 10), t, expectStartEnd);
  if (expectLen) has(label + " 账期长度", "payDay=" + payDay + "，账期应为 " + expectLen + " 天", t, "/" + expectLen + " 天");
}
periodCase("T1", "2026-03-01T12:00:00", 28, "03-01 → 03-28", 28);
periodCase("T2", "2026-03-05T12:00:00", 31, "03-01 → 03-31", 31);
periodCase("T3", "2026-02-20T12:00:00", 31, "02-01 → 02-28", 28);
periodCase("T4", "2028-02-20T12:00:00", 31, "02-01 → 02-29", 29);
periodCase("T5", "2026-12-31T12:00:00", 1, "12-02 → 01-01", 31);
periodCase("T6", "2027-03-01T12:00:00", 31, "03-01 → 03-31", 31);

// 相邻账期首尾相接（发薪日 28/29/30/31 各测一次 1 月→2 月）
function titleRange(t) {
  const m = t.match(/(\d\d-\d\d) → (\d\d-\d\d)/);
  return m ? { s: m[1], e: m[2] } : null;
}
function nextDay(mmdd) {
  const [mm, dd] = mmdd.split("-").map(Number);
  const d = new RealDate(2026, mm - 1, dd);
  d.setDate(d.getDate() + 1);
  const p = n => (n < 10 ? "0" + n : "" + n);
  return p(d.getMonth() + 1) + "-" + p(d.getDate());
}
[28, 29, 30, 31].forEach(pd => {
  fresh("2026-01-15T12:00:00", Object.assign({}, S_BASE, { payDay: pd }));
  const a = titleRange(calTitle());
  fresh("2026-02-15T12:00:00", Object.assign({}, S_BASE, { payDay: pd }));
  const b = titleRange(calTitle());
  const scenario = "payDay=" + pd + "，1 月账期结束的次日应等于 2 月账期开始";
  if (!a || !b) failLine("T7 payDay=" + pd + " 账期相接", scenario, "能读到两个账期", calTitle());
  else eq("T7 payDay=" + pd + " 账期相接", scenario, b.s, nextDay(a.e));
});

/* =====================================================================
 * 2. 金额口径：记录优先 → 无记录工作日=标准日薪 → 无记录周末/节假日=0 → off=0
 * ===================================================================*/
console.log("\n=== 2. 本期已赚口径（记录优先，其次制度日薪，最后 0） ===");

// 基线：2026-11-03（账期 10-16→11-15），已过 12 个工作日，无记录
fresh("2026-11-03T12:00:00", S_BASE);
num("B1 无记录=12 个工作日 × 标准日薪", "11-03 打开，账期内已过 12 个工作日、无任何记录", sumMoney(), 12 * DAYPAY, 1.0);

// B2 工作日有记录 → 用记录金额（只上 2h 存档 112.64，不该按 450.57 算）
const rec1102 = { startMs: new RealDate(2026, 10, 2, 9, 0).getTime(), endMs: new RealDate(2026, 10, 2, 11, 0).getTime(), pauses: [], earnedMs: 2 * 3600000, earned: 112.64, rate: RATE };
fresh("2026-11-03T12:00:00", S_BASE, { "2026-11-02": rec1102 });
num("B2 工作日有记录 → 以记录为准", "11-02 只上 2 小时存档 112.64（标准日薪 450.57）", sumMoney(), 12 * DAYPAY - DAYPAY + 112.64, 1.0);

// B3 周末有记录 → 计入
const recSat = { startMs: new RealDate(2026, 9, 31, 9, 0).getTime(), endMs: new RealDate(2026, 9, 31, 10, 0).getTime(), pauses: [], earnedMs: 3600000, earned: 56.32, rate: RATE };
fresh("2026-11-03T12:00:00", S_BASE, { "2026-10-31": recSat });
num("B3 周末有记录 → 计入本期", "10-31 周六真上班存档 56.32，无记录周末本来不计", sumMoney(), 12 * DAYPAY + 56.32, 1.0);

// B4 法定假日有记录 → 计入（10-05 时账期 09-16→10-15，已过 11 个工作日）
const recHoliday = { startMs: new RealDate(2026, 9, 1, 9, 0).getTime(), endMs: new RealDate(2026, 9, 1, 10, 0).getTime(), pauses: [], earnedMs: 3600000, earned: 56.32, rate: RATE };
fresh("2026-10-05T12:00:00", S_BASE, { "2026-10-01": recHoliday });
num("B4 法定假日有记录 → 计入本期", "10-01 国庆真上班存档 56.32，工程里按上班日算钱会被制度日薪覆盖", sumMoney(), 11 * DAYPAY + 56.32, 1.0);

// B5 标记 off → 0（有/无记录都该是 0）
fresh("2026-11-03T12:00:00", S_BASE, { "2026-11-02": { off: true } });
num("B5 off 标记 → 0", "11-02 标记休息，账期内少一天日薪", sumMoney(), 11 * DAYPAY, 1.0);

// B6 今天实时叠加（今天不该被算成整天日薪）
fresh("2026-11-03T12:00:00", S_BASE);
click("btnStart");
num("B6 今天实时 = 08:30→12:00 扣午休 0.5h", "11-03 12:00 点开始（回填 08:30，午休 11:30-12:00）", sumMoney(), 12 * DAYPAY + 3 * RATE, 1.0);

// B7 导出本期 CSV 同口径
fresh("2026-11-03T12:00:00", S_BASE, { "2026-11-02": rec1102 });
blobs = [];
click("btnExport");
const line1102 = csvLine(blobs[0] || "", "2026-11-02");
has("B7 导出本期同口径", "11-02 有 112.64 存档，导出本期该行应为 112.64 而不是 450.57", line1102, "112.64");
notHas("B7b 导出本期不再用制度日薪", "11-02 有记录时不应再出现 450.57", line1102, "450.57");

/* =====================================================================
 * 3. 夜班：22:00-06:00 = 8h（含 0.5h 夜宵 → 7.5h），跨天收尾在次日 06:00
 * ===================================================================*/
console.log("\n=== 3. 夜班 22:00-06:00（跨天） ===");
fresh("2026-11-03T22:30:00", S_NIGHT);
has("C1 夜班工时=7.5h", "22:00→06:00 扣 02:00-02:30 夜宵", txtOf("formula"), "÷ 7.5 小时");
has("C1b 夜班时薪 60.08", "9800 ÷ 21.75 ÷ 7.5", txtOf("rateTxt"), "60.08");
click("btnStart");
num("C2 22:30 开始已赚 = 0.5h", "点开始回填到 22:00，到 22:30 计 0.5 小时", moneyOf("todayEarn"), 0.5 * NIGHT_RATE, 0.5);
eq("C3 夜班倒计时 = 07:30:00", "22:30 时距次日 06:00 还有 7.5 小时", txtOf("countdown"), "07:30:00");

fresh("2026-11-02T22:00:00", S_NIGHT);
click("btnStart");
advance(8 * 3600 + 10 * 60);   // 到 11-03 06:10，触发跨天收尾
const nightRec = recs()["2026-11-02"] || {};
if (nightRec.startMs) {
  const fmt = t => new RealDate(t).toLocaleString("zh-CN", { hour12: false });
  const rate = nightRec.rate || 0;
  const mins = ((nightRec.endMs || 0) - (nightRec.startMs || 0)) / 60000;
  console.log("  · 场景参数: 上班 " + fmt(nightRec.startMs) + " / 收尾 " + fmt(nightRec.endMs) +
    "（自然时长 " + mins + " 分钟）/ 夜宵 02:00-02:30 / rate=" + rate.toFixed(4) +
    " / earnedMs=" + nightRec.earnedMs + "（" + (nightRec.earnedMs / 3600000).toFixed(2) + "h）");
}
num("C4 跨天收尾：endMs−startMs = 8h", "22:00 上班后跨到次日 06:10，收尾应落在次日 06:00", (nightRec.endMs || 0) - (nightRec.startMs || 0), 8 * 3600000, 1000);
num("C4b 跨天收尾金额 = 7.5h（扣 0.5h 夜宵）", "自然 8h − 02:00-02:30 夜宵 = 7.5h，按夜班时薪 60.0766 计", nightRec.earned || 0, 7.5 * NIGHT_RATE, 1.0);

/* =====================================================================
 * 4. 2027 法定节假日：官方未公布，页面只能提示，不能假装有数据
 * ===================================================================*/
console.log("\n=== 4. 2027 法定节假日（官方未公布） ===");
fresh("2027-01-05T12:00:00", S_BASE);
has("D1 跨年账期有「2027 假期未公布」提示", "账期跨到 2027 时不应假装有假期数据", calTitle(), "2027 假期未公布");
num("D2 2027-01-02 周六 0 元", "无记录的周末不计钱", cellMoney("2027-01-02"), 0, 0.001);
num("D3 2027-01-03 周日 0 元", "无记录的周末不计钱", cellMoney("2027-01-03"), 0, 0.001);
// 已知取舍（不算失败）：2027-01-01 元旦在假期表缺位时按制度工作日计 ¥450.57，靠标题提示兜底
console.log("  ℹ️ 2027-01-01 元旦当前按制度日薪 ¥" + cellMoney("2027-01-01").toFixed(2) + "（假期表未公布，标题已提示，属已知取舍）");

/* =====================================================================
 * 5. 清空全部数据后金额归零
 * ===================================================================*/
console.log("\n=== 5. 清空全部数据 ===");
fresh("2026-11-03T12:00:00", S_BASE, { "2026-11-02": rec1102 });
const beforeClear = sumMoney();
click("btnClear");
num("E1 清空后本期已赚 = 0", "清空前 " + beforeClear.toFixed(2) + "，三次确认清空 R 与标记", sumMoney(), 0, 0.01);
eq("E2 清空后记录为空", "清空后 localStorage 记录对象应为 {}", JSON.stringify(recs()), "{}");

/* =====================================================================
 * 6. 写盘频率：计时中每秒最多写 1~2 次全量 JSON（默认 100ms → 10 次是问题）
 * ===================================================================*/
console.log("\n=== 6. 计时写盘频率 ===");
fresh("2026-11-03T12:00:00", Object.assign({}, S_BASE, { freq: undefined })); // 用页面 DEFAULT.freq
click("btnStart");
const ft = fastTimer();
if (!ft) {
  passLine("F1 计时写盘频率（页面默认间隔 ≥ 500ms）");
} else {
  const w0 = writes;
  for (let i = 0; i < 10; i++) ft.fn();
  const w = writes - w0;
  w <= 2 ? passLine("F1 计时写盘频率（模拟 1 秒最多 2 次写盘）")
         : failLine("F1 计时写盘频率", "默认 100ms 档模拟 1 秒 10 个 tick，" + "实测写盘 " + w + " 次全量 records",
             "≤ 2 次/秒", w + " 次/秒（" + ft.ms + "ms 间隔）");
}

/* =====================================================================
 * 7. 首次向导保存后日历重绘
 * ===================================================================*/
console.log("\n=== 7. 首次向导保存后日历 ===");
fresh("2026-11-03T12:00:00", null, null);   // 无设置 → 自动弹向导
nodes["mSalary"].value = "20000";
nodes["mDays"].value = "21.75";
nodes["mStart"].value = "08:00";
nodes["mEnd"].value = "20:00";
nodes["mBS"].value = "12:00";
nodes["mBE"].value = "13:00";
click("mSave");
num("G1 向导保存后日历按新日薪重绘", "月薪 20000、08:00-20:00（11h）→ 日薪 919.54，11-02 格应显示 919", cellMoney("2026-11-02"), 919.54, 1.0);

/* =====================================================================
 * 8. 下班存档 / 继续计时：口径以 confirm 文案为准（按上班时间重算 = 含离开时间）
 * ===================================================================*/
console.log("\n=== 8. 下班存档 / 继续计时 ===");
fresh("2026-11-03T09:00:00", S_BASE);
has("H1 继续计时按钮文案标明回滚存档", "按钮应叫「继续计时」并说明会覆盖存档", staticTxt("btnRestart"), "继续计时");
click("btnStart");
advance(8 * 3600);                 // 17:00
click("btnStop");                  // 存档
const stopped = moneyOf("todayEarn");
num("H2 下班存档 = 09:00→17:00 扣 2.5h 午休 = 6h", "18:00 下班前 17:00 点下班存档", stopped, 6 * RATE, 1.0);
advance(30 * 60);                  // 17:30 回来
click("btnRestart");               // 继续计时（confirm 说明按上班时间重算）
num("H3 继续计时按上班时间重算（含离开的 30 分钟）", "17:30 继续后应回到 08:30→17:30 扣 2.5h = 6.5h，与 confirm 文案一致", moneyOf("todayEarn"), 6.5 * RATE, 0.5);
console.log("  ℹ️ 继续计时会把离开的 30 分钟也算进工时（模型无暂停，confirm 已写明「按上班时间重新算」）");

/* ---------------- 汇总 ---------------- */
console.log("\n==============================");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("==============================");
process.exit(fail ? 1 : 0);
