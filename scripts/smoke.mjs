/**
 * End-to-end smoke test over the Chrome DevTools Protocol. No extra dependencies: it uses the system
 * Chrome, serves dist/ from a throwaway local server (so the manifest + service worker are exercised),
 * drives the real UI with mouse/keyboard events, and fails on any console error.
 *
 *   npm run smoke -- [width] [height]                      (default 430x900; try 375 667 and 1280 800)
 *   npm run smoke:live                                     (adds --live: builds a feed-enabled bundle and mocks Supabase)
 *
 * --live builds a second bundle configured for https://smoke.supabase.co with a FAKE anon key, then answers those
 * requests from an in-process mock via CDP Fetch interception. It exercises live updates, an open sheet updating,
 * an outage, a malformed payload and recovery. No real Supabase project or key is ever involved.
 *
 * Screenshots land in smoke-out/ (git-ignored). Set CHROME=/path/to/chrome to override the macOS default.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const LIVE = process.argv.includes("--live");
const [W = 430, H = 900] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const OUT = `${W}x${H}${LIVE ? "-live" : ""}`;
const ROOT = new URL("../", import.meta.url).pathname;
const FAKE_B64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const FAKE_ANON = `${FAKE_B64({ alg: "HS256", typ: "JWT" })}.${FAKE_B64({ role: "anon", iss: "smoke-test" })}.fake-signature`;
// Always test a bundle built by THIS script so the run is hermetic: feed OFF (bundled counts) normally, or a feed
// pointed at the in-process mock with --live. It never depends on dist/ or on your real .env.local.
const DIST = join(ROOT, "smoke-out", LIVE ? "dist-live" : "dist-off");
{
  const env = { ...process.env, HOKIEPARK_SUPABASE_URL: "", HOKIEPARK_SUPABASE_ANON_KEY: "", HOKIEPARK_POLL_MS: "" };
  if (LIVE) Object.assign(env, { HOKIEPARK_SUPABASE_URL: "https://smoke.supabase.co", HOKIEPARK_SUPABASE_ANON_KEY: FAKE_ANON, HOKIEPARK_POLL_MS: "1000" });
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/build.ts"), "--out", DIST], { env, encoding: "utf8" });
  if (r.status !== 0) throw new Error("smoke build failed: " + r.stderr + r.stdout);
}
const DIR = join(ROOT, "smoke-out") + "/";
const CH = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(CH)) throw new Error(`Chrome not found at ${CH}; set CHROME=/path/to/chrome`);
mkdirSync(DIR, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const file = join(DIST, path === "/" ? "index.html" : path.replace(/\.\.+/g, ""));
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const APP = `http://127.0.0.1:${server.address().port}/index.html`;

// Chrome picks a free debugging port itself (port 0) and reports it in DevToolsActivePort, so a stale browser from an
// earlier crashed run can never be mistaken for this one. It is always killed on exit, crash or Ctrl+C.
const userDir = mkdtempSync(join(tmpdir(), "hokiepark-smoke-"));
const proc = spawn(CH, ["--headless=new", "--disable-gpu", "--remote-debugging-port=0", "--user-data-dir=" + userDir, "--no-first-run", "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { proc.kill("SIGKILL"); } catch {} try { server.close(); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
process.on("uncaughtException", (e) => { console.error("FAIL  smoke crashed:", e.message); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("FAIL  smoke crashed:", e?.message ?? e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PORT, targets;
for (let i = 0; i < 100 && !PORT; i++) {
  try { PORT = readFileSync(join(userDir, "DevToolsActivePort"), "utf8").split("\n")[0].trim(); } catch {}
  if (!PORT) await sleep(150);
}
if (!PORT) throw new Error("Chrome did not start (no DevToolsActivePort)");
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find((t) => t.type === "page")) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
// During deliberate outage phases, failed requests to the mock host are expected browser noise (nothing else is).
let expectFailures = false;
const addErr = (text) => errors.push({ text, expected: expectFailures && /smoke\.supabase\.co/.test(text) });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === "Runtime.exceptionThrown") addErr(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type)) addErr(`console.${d.params.type}: ` + d.params.args.map((a) => a.value ?? a.description).join(" "));
  if (d.method === "Log.entryAdded" && ["error", "warning"].includes(d.params.entry.level)) addErr(`log.${d.params.entry.level}: ${d.params.entry.text} ${d.params.entry.url ?? ""}`);
  if (d.method === "Fetch.requestPaused") void onPaused(d.params);
};

// ---- controllable mock of the Supabase REST endpoint (only used with --live) ----
import { SEED_LEVELS } from "../src/data/garages.ts";
import { GARAGES, LOTS } from "../src/data/index.ts";
import { eligibleOpen, levelAllows, lotAllows, lotDimmed } from "../src/lib/permits.ts";
import { garageTotals } from "../src/lib/occupancy.ts";
const garageTotalsOpen = (g) => garageTotals(g).open;
const mock = {
  mode: "ok", // ok | down (HTTP 503) | bad (200 with an out-of-range row)
  requests: [],
  rows: Object.entries(SEED_LEVELS).flatMap(([garage_id, ls]) => ls.map((l, i) => ({ garage_id, level_index: i, label: l.label, capacity: l.capacity, occupied: l.occupied, ada_capacity: l.adaCapacity, ada_occupied: l.adaOccupied, updated_at: new Date().toISOString() }))),
};
const CORS = [{ name: "access-control-allow-origin", value: "*" }, { name: "access-control-allow-headers", value: "apikey,authorization,accept,content-type" }, { name: "access-control-allow-methods", value: "GET,OPTIONS" }];
async function onPaused({ requestId, request }) {
  const fulfill = (responseCode, headers, body = "") => send("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: headers, body: Buffer.from(body).toString("base64") });
  if (request.method === "OPTIONS") return fulfill(204, CORS);
  mock.requests.push(request);
  if (mock.mode === "down") return fulfill(503, CORS, "down");
  const rows = mock.mode === "bad" ? [{ ...mock.rows[0], occupied: 99999 }] : mock.rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  return fulfill(200, [...CORS, { name: "content-type", value: "application/json" }], JSON.stringify(rows));
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${DIR}${OUT}-${name}.png`, Buffer.from(r.result.data, "base64")); };
const center = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const click = async (sel) => { const c = await center(sel); if (!c) throw new Error("no element " + sel); for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: "left", clickCount: 1 }); await sleep(120); };
let failures = 0;
const check = (label, cond, extra = "") => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`); };

await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 2, mobile: +W < 500 });
if (LIVE) await send("Fetch.enable", { patterns: [{ urlPattern: "https://smoke.supabase.co/*" }] });
const URL_ = APP;
await send("Page.navigate", { url: URL_ });
await sleep(1200);
await shot("1-map");

const vb0 = await ev(`document.querySelector('.map-svg').getAttribute('viewBox')`);
check("map rendered", (await ev(`document.querySelectorAll('.bldg').length`)) >= 90, `buildings=${await ev(`document.querySelectorAll('.bldg').length`)}`);
check("2 garage + 19 lot markers", (await ev(`document.querySelectorAll('.marker-garage').length`)) === 2 && (await ev(`document.querySelectorAll('.marker-lot').length`)) === 19);

// tap a garage marker
await click('.marker-garage[data-id="perry-street"]');
await sleep(700);
check("tap garage opens sheet", (await ev(`document.getElementById('sheet').hidden`)) === false);
check("sheet title is Perry Street Garage", (await ev(`document.getElementById('sheet-title')?.textContent`)) === "Perry Street Garage");
check("sheet has 5 level rows", (await ev(`document.querySelectorAll('#sheet .level').length`)) === 5);
await shot("2-garage-sheet");
await ev(`document.getElementById('sheet').scrollTop = 9999`); await shot("2b-garage-sheet-scrolled");

// close via button
await click('#sheet [data-close]');
check("close button hides sheet", (await ev(`document.getElementById('sheet').hidden`)) === true);

// tap a lot marker with ADA
await click('.marker-lot[data-id="lot-squires"]');
await sleep(700);
check("lot sheet shows ADA note", (await ev(`document.querySelector('#sheet .ada-note')!==null`)));
await shot("3-lot-sheet");

// tap a building
await click('#sheet [data-close]');
await ev(`document.querySelector('.bldg[data-id="b0176"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientX:5,clientY:5}))`);
await ev(`document.querySelector('.map-svg').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:5,clientY:5}))`);
await sleep(700);
check("tap building opens Burruss sheet w/ nearest parking", (await ev(`document.getElementById('sheet-title')?.textContent`)) === "Burruss Hall" && (await ev(`document.querySelectorAll('#sheet .rows li').length`)) === 3);
await shot("4-building-sheet");

// list -> fly-to
await click('.tabbar [data-view="list"]');
await shot("5-list");
await ev(`(()=>{const i=document.getElementById('list-q');i.value='squ';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const rows = await ev(`document.querySelectorAll('#list-results .row').length`);
check("search 'squ' narrows list", rows >= 1 && rows < 5, `rows=${rows}`);
await ev(`(()=>{const i=document.getElementById('list-q');i.value='zzzz';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
check("no-match empty state", (await ev(`document.querySelector('#list-results .state-msg')?.textContent`))?.includes("No garages or lots match"));
await ev(`(()=>{const i=document.getElementById('list-q');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const before = await ev(`document.querySelector('.map-svg').getAttribute('viewBox')`);
await click('#list-results .row[data-id="lot-coliseum-west"]');
await sleep(900);
const after = await ev(`document.querySelector('.map-svg').getAttribute('viewBox')`);
check("list selection returns to map with sheet", (await ev(`document.getElementById('view-map').hidden`)) === false && (await ev(`document.getElementById('sheet-title')?.textContent`)) === "Coliseum West");
check("fly-to changed viewBox (zoomed in)", +after.split(" ")[2] < +vb0.split(" ")[2] * 0.5, `w ${vb0.split(" ")[2]} -> ${after.split(" ")[2]}`);
await shot("6-flyto-coliseum");

// map selected row highlight in list
await click('.tabbar [data-view="list"]');
check("list highlights map selection", (await ev(`document.querySelector('#list-results .row.is-selected')?.dataset.id`)) === "lot-coliseum-west");
await click('.tabbar [data-view="map"]');

// zoom + pan
await click('#zoom-reset'); await sleep(700);
const w0 = +(await ev(`document.querySelector('.map-svg').getAttribute('viewBox')`)).split(" ")[2];
await click('#zoom-in'); await click('#zoom-in');
const w1 = +(await ev(`document.querySelector('.map-svg').getAttribute('viewBox')`)).split(" ")[2];
check("zoom-in buttons shrink viewBox", w1 < w0 * 0.5, `${w0.toFixed(0)} -> ${w1.toFixed(0)}`);
const vbA = await ev(`document.querySelector('.map-svg').getAttribute('viewBox')`);
const m = await center('.map-svg');
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: m.x, y: m.y, button: "left", clickCount: 1 });
for (let i = 1; i <= 8; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: m.x + i * 12, y: m.y + i * 6, button: "left" });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: m.x + 96, y: m.y + 48, button: "left", clickCount: 1 });
const vbB = await ev(`document.querySelector('.map-svg').getAttribute('viewBox')`);
check("drag pans (viewBox origin moved)", vbA !== vbB);
check("drag did not open a sheet", (await ev(`document.getElementById('sheet').hidden`)) === true);
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: m.x, y: m.y, deltaX: 0, deltaY: -300 });
const w2 = +(await ev(`document.querySelector('.map-svg').getAttribute('viewBox')`)).split(" ")[2];
check("wheel zooms in", w2 < +vbB.split(" ")[2]);
await shot("7-zoomed");
await click('#zoom-reset'); await sleep(700);
await ev(`document.querySelector('.map-svg').dispatchEvent(new WheelEvent('wheel',{deltaY:400,bubbles:true,cancelable:true,clientX:200,clientY:300}))`);

// keyboard: focus marker + Enter
await ev(`document.querySelector('.marker-garage[data-id="north-end-center"]').focus()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await sleep(400);
check("Enter on focused marker opens sheet", (await ev(`document.getElementById('sheet-title')?.textContent`)) === "North End Center Garage");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(200);
check("Escape closes sheet", (await ev(`document.getElementById('sheet').hidden`)) === true);

// Ask tab: the three acceptance questions
await click('.tabbar [data-view="ask"]'); await shot("8-ask");
const botText = () => ev(`[...document.querySelectorAll('#chat-log .msg.bot')].pop()?.innerText`);
const chips = await ev(`document.querySelectorAll('.chip').length`);
check("3 suggestion chips", chips === 3);
await click('.chip:nth-child(3)'); await sleep(300);
let t = await botText();
check("Q3 most open garage = North End Center 179 of 405", /North End Center Garage has the most open spaces right now: 179 of 405/.test(t), JSON.stringify(t?.slice(0, 90)));
await click('.chip:nth-child(1)'); await sleep(300);
t = await botText();
check("Q1 closest parking to Squires names a garage + lot", /Closest parking to Squires Student Center/.test(t) && /North End Center Garage: 179 of 405/.test(t) && /lot/.test(t), JSON.stringify(t?.slice(0, 120)));
await click('.chip:nth-child(2)'); await sleep(300);
t = await botText();
check("Q2 ADA near Cassell mentions Coliseum West 12 spaces", /Coliseum West lot/.test(t) && /12 designated accessible spaces/.test(t), JSON.stringify(t?.slice(0, 120)));
await shot("8b-ask-answers");
// typed question via input + form submit
await ev(`(()=>{const i=document.getElementById('chat-q');i.value='is perry street garage full?';})()`);
await ev(`document.getElementById('chat-form').requestSubmit()`); await sleep(300);
t = await botText();
check("typed question answered with level rows", /Level 1 - Commuter & graduate: 0 open of 120 \(Full\)/.test(t));
// show on map hand-off
await click('#chat-log .msg.bot:last-child .ref');
await sleep(900);
check("'Show on map' returns to map with sheet open", (await ev(`document.getElementById('view-map').hidden`)) === false && (await ev(`document.getElementById('sheet').hidden`)) === false, await ev(`document.getElementById('sheet-title')?.textContent`));
await shot("8c-ask-to-map");
const http = URL_.startsWith("http");
check("PWA: apple-touch-icon present", await ev(`!!document.querySelector('link[rel=apple-touch-icon]')`));
check(http ? "PWA: manifest link injected over http" : "PWA: no manifest link on file:// (avoids console error)", (await ev(`!!document.querySelector('link[rel=manifest]')`)) === http);
if (http) {
  const mf = await ev(`fetch('manifest.webmanifest').then(r=>r.json()).then(j=>({n:j.short_name,d:j.display,i:j.icons.length}))`);
  check("PWA: manifest parses (standalone, 3 icons)", mf.d === "standalone" && mf.i === 3, JSON.stringify(mf));
  await sleep(800);
  const sw = await ev(`navigator.serviceWorker.getRegistration().then(r=>!!(r&&(r.active||r.installing||r.waiting)))`);
  check("PWA: service worker registered", sw === true);
  await sleep(800);
  const cached = await ev(`caches.keys().then(async k=>{const c=await caches.open(k[0]);return (await c.keys()).map(r=>new URL(r.url).pathname)})`);
  check("PWA: shell precached", cached.includes("/index.html") && cached.some((p) => p.endsWith("icon-192.png")), JSON.stringify(cached));
  await send("Network.enable"); await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send("Page.reload"); await sleep(1500);
  check("PWA: app loads OFFLINE from cache", (await ev(`document.querySelectorAll('.bldg').length`)) >= 90);
  await shot("9-offline");
}
// ---- Phase 5: cross-view number audit. Marker, list row, sheet, level rows and assistant must agree. ----
async function audit(tag) {
for (const [gid, gname] of [["perry-street", "Perry Street Garage"], ["north-end-center", "North End Center Garage"]]) {
  await click('.tabbar [data-view="map"]');
  const m = await ev(`(()=>{const l=document.querySelector('.marker-garage[data-id="${gid}"]').getAttribute('aria-label');const r=l.match(/(\\d+) of (\\d+) spaces open, (\\d+) accessible open/);return r?{open:+r[1],cap:+r[2],ada:+r[3]}:null})()`);
  check(`audit[${tag}] ${gname}: marker label parsed`, !!m, JSON.stringify(m));
  if (!m) continue;
  // list row
  await click('.tabbar [data-view="list"]');
  const list = await ev(`(()=>{const b=document.querySelector('#list-results .row[data-id="${gid}"]');return {sub:b.querySelector('.sub').innerText,ada:b.querySelector('.ada').getAttribute('aria-label')}})()`);
  check(`audit[${tag}] ${gname}: list row matches marker`, list.sub.includes(`${m.open} of ${m.cap} open`) && list.ada === `${m.ada} accessible spaces open`, JSON.stringify(list));
  // sheet (open from the list, exactly like a user would)
  await click(`#list-results .row[data-id="${gid}"]`); await sleep(700);
  const sheet = await ev(`(()=>{const q=(s)=>document.querySelector('#sheet '+s);const lv=[...document.querySelectorAll('#sheet .level')].map(e=>({open:+e.querySelector('.level-bottom strong').innerText,ada:+e.querySelector('.ada').innerText.trim()}));return {big:+q('.big').innerText,of:q('.of').innerText,ada:q('.summary .ada').innerText.trim(),sumOpen:lv.reduce((a,b)=>a+b.open,0),sumAda:lv.reduce((a,b)=>a+b.ada,0)}})()`);
  check(`audit[${tag}] ${gname}: sheet totals match marker`, sheet.big === m.open && sheet.of.includes(`/ ${m.cap} open`) && sheet.ada.startsWith(String(m.ada)), JSON.stringify(sheet));
  check(`audit[${tag}] ${gname}: level rows sum to totals`, sheet.sumOpen === m.open && sheet.sumAda === m.ada);
  // assistant
  await click('.tabbar [data-view="ask"]');
  await ev(`document.getElementById('chat-q').value=${JSON.stringify("is " + gname + " full?")}`);
  await ev(`document.getElementById('chat-form').requestSubmit()`); await sleep(300);
  const ans = await ev(`[...document.querySelectorAll('#chat-log .msg.bot')].pop().innerText`);
  check(`audit[${tag}] ${gname}: assistant matches marker`, ans.includes(`${gname}: ${m.open} of ${m.cap} open`) && ans.includes(`${m.ada} accessible open`), JSON.stringify(ans.split("\n")[0]));
}
await click('.tabbar [data-view="map"]');
}
await audit("initial");

// ---- permit filter (runs before any live-data changes, so expected numbers come straight from the seed) ----
{
  const selectPermit = async (v) => { await ev(`(()=>{const s=document.getElementById('permit');s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(250); };
  const ids = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e=>e.dataset.id).sort()`);
  const sameSet = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort());
  const nec = GARAGES.find((g) => g.id === "north-end-center"), perry = GARAGES.find((g) => g.id === "perry-street");
  await click('.tabbar [data-view="map"]'); await click('#zoom-reset'); await sleep(700);

  await selectPermit("commuter");
  const expectDim = LOTS.filter((l) => lotDimmed(l, "commuter")).map((l) => l.id);
  check(`permit: commuter dims exactly the ${expectDim.length} ineligible non-ADA lots`, sameSet(await ids("path.lot.ineligible"), expectDim), JSON.stringify(await ids("path.lot.ineligible")));
  check("permit: accessible (ADA) lots are never dimmed", (await ev(`document.querySelectorAll('.lot-ada.ineligible, .marker.has-ada.ineligible').length`)) === 0);
  check("permit: garages stay undimmed for commuter (both have commuter levels)", (await ids(".marker-garage.ineligible")).length === 0);

  await click('.marker-garage[data-id="north-end-center"]'); await sleep(700);
  const note = await ev(`document.querySelector('#sheet .permit-note')?.innerText`);
  check("permit: garage sheet shows eligible-open total", note?.includes(`${eligibleOpen(nec, "commuter")} open`) && note.includes("Commuter"), JSON.stringify(note));
  const off = await ev(`document.querySelectorAll('#sheet .level-off').length`);
  check("permit: levels not allowed for commuter are flagged", off === nec.levels.filter((l) => !levelAllows(l, "commuter")).length && off > 0, `flagged=${off}`);
  check("permit: headline totals are NOT changed by the filter (still all open spaces)", (await ev(`document.querySelector('#sheet .big')?.innerText`)) === String(garageTotalsOpen(nec)));
  await click('#sheet [data-close]');
  await click('#zoom-reset'); await sleep(700);
  await click('.marker-garage[data-id="perry-street"]'); await sleep(700);
  check("permit: Perry has 0 open commuter spaces (its only commuter level is full)", (await ev(`document.querySelector('#sheet .permit-note')?.innerText`)).includes("0 open"));
  await shot("12-permit-commuter-sheet");
  await click('#sheet [data-close]');

  // resident: no garage levels at all -> both garage markers dim; ADA still not dimmed
  await selectPermit("resident");
  check("permit: resident dims both garages (no resident levels)", (await ids(".marker-garage.ineligible")).length === 2);
  check("permit: ADA lots still undimmed for resident", (await ev(`document.querySelectorAll('.lot-ada.ineligible').length`)) === 0);

  // list: annotations + "only my permit" filter
  await selectPermit("commuter");
  await click('.tabbar [data-view="list"]');
  const sub = await ev(`document.querySelector('#list-results .row[data-id="north-end-center"] .sub').innerText`);
  check("permit: list garage row shows the eligible number", sub.includes(`${eligibleOpen(nec, "commuter")} for your permit`) && sub.includes("179 of 405 open"), sub);
  const pill = await ev(`document.querySelector('#list-results .row[data-id="perry-street"] .pill').innerText`);
  check("permit: list pill says 'Full for you' when the permit's levels are full", pill === "Full for you", pill);
  const before = await ev(`document.querySelectorAll('#list-results .row').length`);
  await click('#only-mine');
  const expectRows = GARAGES.filter((g) => g.levels.some((l) => levelAllows(l, "commuter"))).length + LOTS.filter((l) => lotAllows(l, "commuter") || l.hasADA).length;
  const after = await ev(`document.querySelectorAll('#list-results .row').length`);
  check("permit: 'only my permit' hides ineligible options but keeps ADA lots", after === expectRows && after < before, `${before} -> ${after}`);
  await shot("13-permit-list");
  await click('#only-mine');

  // assistant honors the picked permit
  await click('.tabbar [data-view="ask"]');
  await ev(`document.getElementById('chat-q').value='Where is the closest open parking to Newman Library?'`);
  await ev(`document.getElementById('chat-form').requestSubmit()`); await sleep(300);
  const ans = await ev(`[...document.querySelectorAll('#chat-log .msg.bot')].pop().innerText`);
  check("permit: assistant restricts to the picked permit with matching numbers", /Closest parking for a Commuter permit to Newman Library/.test(ans) && ans.includes(`${eligibleOpen(nec, "commuter")} open on levels for a Commuter permit`) && /Perry Street Garage has no open spaces for a Commuter permit/.test(ans), JSON.stringify(ans.split("\n").slice(0, 3)));
  await shot("14-permit-assistant");

  // persistence across a reload; then clear it
  await click('.tabbar [data-view="map"]');
  await send("Page.reload"); await sleep(1500);
  check("permit: choice survives a reload (dropdown + dimming)", (await ev(`document.getElementById('permit').value`)) === "commuter" && sameSet(await ids("path.lot.ineligible"), expectDim));
  await selectPermit("");
  check("permit: 'Any permit' clears all dimming", (await ev(`document.querySelectorAll('.ineligible').length`)) === 0);
  await ev(`localStorage.getItem('hokiepark.permit')`);
  check("permit: cleared choice is not persisted", (await ev(`localStorage.getItem('hokiepark.permit')`)) === null);
  // junk in storage is ignored, not trusted
  await ev(`localStorage.setItem('hokiepark.permit','<img src=x onerror=alert(1)>')`);
  await send("Page.reload"); await sleep(1500);
  check("permit: junk in storage is rejected (falls back to Any permit)", (await ev(`document.getElementById('permit').value`)) === "" && (await ev(`document.querySelectorAll('.ineligible').length`)) === 0);
  await ev(`localStorage.removeItem('hokiepark.permit')`);
}

// ---- chip + live feed ----
const chipText = () => ev(`document.getElementById('sync').textContent`);
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
const markerLabel = (gid) => ev(`document.querySelector('.marker-garage[data-id="${gid}"]').getAttribute('aria-label')`);
const hdr = (req, name) => Object.entries(req.headers).find(([k]) => k.toLowerCase() === name)?.[1];
if (!LIVE) {
  check("chip says 'Sample data' when the feed is not configured", (await chipText()) === "Sample data", await chipText());
} else {
  check("live: chip reaches 'Live' after first sync", await waitFor(async () => /^Live/.test(await chipText())), await chipText());
  check("live: requests hit /rest/v1/garage_levels with the anon key and no privileged key",
    mock.requests.length > 0 && mock.requests.every((r) => /^https:\/\/smoke\.supabase\.co\/rest\/v1\/garage_levels\?/.test(r.url) && hdr(r, "apikey") === FAKE_ANON && !/service_role|sb_secret/.test(JSON.stringify(r.headers))),
    `requests=${mock.requests.length}`);

  // 1) a database change reaches map, list, sheet and assistant
  mock.rows.find((r) => r.garage_id === "perry-street" && r.level_index === 1).occupied = 139; // 112 -> 139: Perry open 133 -> 106
  check("live: DB change updates the map marker", await waitFor(async () => /106 of 650/.test(await markerLabel("perry-street"))), await markerLabel("perry-street"));
  await audit("after live update");

  // 2) an open sheet updates in place and keeps its scroll position
  await click('#zoom-reset'); await sleep(700); // the audit leaves the map zoomed on the last garage; Perry's marker would be off-screen
  await click('.marker-garage[data-id="perry-street"]'); await sleep(700);
  const scrollable = await ev(`(()=>{const s=document.getElementById('sheet');return s.scrollHeight>s.clientHeight+40})()`);
  if (scrollable) await ev(`document.getElementById('sheet').scrollTop = 120`);
  const before = await ev(`document.getElementById('sheet').scrollTop`);
  mock.rows.find((r) => r.garage_id === "perry-street" && r.level_index === 0).occupied = 100; // 120 -> 100: Perry open 106 -> 126
  check("live: open sheet total updates without closing", await waitFor(async () => (await ev(`document.querySelector('#sheet .big')?.innerText`)) === "126"), await ev(`document.querySelector('#sheet .big')?.innerText`));
  if (scrollable) check("live: sheet keeps its scroll position across an update", Math.abs((await ev(`document.getElementById('sheet').scrollTop`)) - before) < 4, `before=${before}`);
  check("live: sheet is still open and titled", (await ev(`document.getElementById('sheet-title')?.textContent`)) === "Perry Street Garage");
  await click('#sheet [data-close]');

  // 3) outage: last known counts stay, chip warns, recovery is automatic
  expectFailures = true;
  mock.mode = "down";
  check("outage: chip shows Offline", await waitFor(async () => (await chipText()) === "Offline"), await chipText());
  check("outage: last known counts stay on screen", /126 of 650/.test(await markerLabel("perry-street")), await markerLabel("perry-street"));
  await shot("10-offline-chip");
  mock.mode = "ok";
  check("outage: recovers to Live by itself (backoff)", await waitFor(async () => /^Live/.test(await chipText()), 20000), await chipText());

  // 4) malformed payload is rejected wholesale
  mock.mode = "bad";
  check("bad payload: chip shows Offline (rejected)", await waitFor(async () => (await chipText()) === "Offline"), await chipText());
  check("bad payload: counts unchanged (all-or-nothing)", /126 of 650/.test(await markerLabel("perry-street")), await markerLabel("perry-street"));
  mock.mode = "ok";
  check("bad payload: recovers to Live", await waitFor(async () => /^Live/.test(await chipText()), 20000), await chipText());
  expectFailures = false;
  await audit("after recovery");
  await shot("11-live-recovered");
}

// horizontal overflow check
check("no horizontal page overflow", (await ev(`document.documentElement.scrollWidth <= window.innerWidth`)));

const unexpected = errors.filter((e) => !e.expected);
check("zero console errors/warnings", unexpected.length === 0, unexpected.map((e) => e.text).join(" | "));
console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} at ${OUT}`);
process.exit(failures ? 1 : 0); // the exit handler closes Chrome and the server
