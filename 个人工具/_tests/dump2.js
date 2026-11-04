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

setClock("2026-03-01T10:00:00"); setRecs({}); setSetting({ salary: 9800, payDay: 28 }); boot();
console.log("PD28 TITLE:", nodes["calTitle"].textContent);
setClock("2026-03-05T10:00:00"); setSetting({ payDay: 31 }); boot();
console.log("PD31 TITLE:", nodes["calTitle"].textContent);
