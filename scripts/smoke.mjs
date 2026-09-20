/**
 * End-to-end smoke test over the Chrome DevTools Protocol. No extra dependencies: it uses the system
 * Chrome, serves dist/ from a throwaway local server (so the manifest + service worker are exercised),
 * drives the real UI with mouse/keyboard events, and fails on any console error.
 *
 *   npm run smoke -- [width] [height]                      (default 430x900; try 375 667 and 1280 800; builds its own feed-off bundle)
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const LIVE = process.argv.includes("--live");
const [W = 430, H = 900] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const OUT = `${W}x${H}${LIVE ? "-live" : ""}`;
const ROOT = new URL("../", import.meta.url).pathname;
const FAKE_B64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const FAKE_ANON = `${FAKE_B64({ alg: "HS256", typ: "JWT" })}.${FAKE_B64({ role: "anon", iss: "smoke-test" })}.fake-signature`;
let DIST = join(ROOT, "dist");
if (LIVE) {
  DIST = join(ROOT, "smoke-out", "dist-live");
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/build.ts"), "--out", DIST], { env: { ...process.env, HOKIEPARK_SUPABASE_URL: "https://smoke.supabase.co", HOKIEPARK_SUPABASE_ANON_KEY: FAKE_ANON, HOKIEPARK_POLL_MS: "1000", HOKIEPARK_ADVISOR: "1" }, encoding: "utf8" });
  if (r.status !== 0) throw new Error("live build failed: " + r.stderr + r.stdout);
}
else {
  // Feed OFF (bundled counts), built by THIS script so the run never depends on dist/ or on a real .env.local.
  DIST = join(ROOT, "smoke-out", "dist-off");
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/build.ts"), "--out", DIST], { env: { ...process.env, HOKIEPARK_SUPABASE_URL: "", HOKIEPARK_SUPABASE_ANON_KEY: "", HOKIEPARK_POLL_MS: "" }, encoding: "utf8" });
  if (r.status !== 0) throw new Error("feed-off build failed: " + r.stderr + r.stdout);
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

// NOTE: no --disable-gpu - the map needs WebGL2 (MapLibre GL JS), which modern headless Chrome
// provides via software rendering (SwiftShader/ANGLE) as long as GPU isn't explicitly disabled.
// Chrome picks a free debugging port itself and reports it in DevToolsActivePort, so a stale browser can never be mistaken for this one.
const userDir = mkdtempSync(join(tmpdir(), "hokiepark-smoke-"));
const proc = spawn(CH, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + userDir, "--no-first-run", "about:blank"], { stdio: "ignore" });
// A crash anywhere below must not leak this Chrome process - a stale one left listening on PORT
// would silently hijack the next run's connection (this bit us once: a crashed earlier run's
// Chrome, still on :9333, answered the new run's CDP handshake with its own stale page).
let cleanedUp = false;
const cleanup = () => {
  if (cleanedUp) return;
  cleanedUp = true;
  try { proc.kill("SIGKILL"); } catch {}
  try { server.close(); } catch {}
  // Delete this run's Chrome profile. Left behind, each one (with the map's tile cache) is large, and dozens of runs once filled the disk.
  try { rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  // Chrome's helper processes can outlive the main one by a moment and recreate files, so sweep once more after they are gone.
  try { spawn("sh", ["-c", `sleep 3; rm -rf "$1"`, "sweep", userDir], { detached: true, stdio: "ignore" }).unref(); } catch {}
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
process.on("exit", cleanup);
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
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
// Benign noise from the third-party OpenFreeMap "liberty" style itself (missing POI sprite icons,
// a filter type quirk in its road-shield layers) - not this app's code, nothing to fix here.
const BENIGN_MAP_STYLE_WARNING = /could not be loaded.*sprite|Expected value to be of type number, but found null instead/;
const addErr = (text) => errors.push({ text, expected: (expectFailures && /smoke\.supabase\.co/.test(text)) || BENIGN_MAP_STYLE_WARNING.test(text) });
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
const mock = {
  mode: "ok", // ok | down (HTTP 503) | bad (200 with an out-of-range row)
  requests: [],
  rows: Object.entries(SEED_LEVELS).flatMap(([garage_id, ls]) => ls.map((l, i) => ({ garage_id, level_index: i, label: l.label, capacity: l.capacity, occupied: l.occupied, ada_capacity: l.adaCapacity, ada_occupied: l.adaOccupied, updated_at: new Date().toISOString() }))),
};
const CORS = [{ name: "access-control-allow-origin", value: "*" }, { name: "access-control-allow-headers", value: "apikey,authorization,accept,content-type" }, { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" }];
// A scripted stand-in for the advisor Edge Function (+ Gemini): it "chooses" tools from the conversation and writes advice from the
// tool results it is shown, exactly like a well-behaved model. Only used with --live (the live build turns the advisor on).
mock.advisorMode = "empty"; // empty (200, no text: the client falls back quietly) | ok (scripted model) | down (HTTP 503)
mock.advisorRequests = [];
function advisorTurn({ contents }) {
  const result = (tool) => { for (const c of [...contents].reverse()) for (const p of c.parts) if (p.functionResponse?.name === tool) return p.functionResponse.response.result; return null; };
  const plan = result("plan_parking"), found = result("find_place");
  let parts;
  if (plan && plan.ok === false) parts = [{ text: "Which permit do you hold, for example commuter or faculty?\nPLACES: none" }];
  else if (plan) { const top = plan.recommended[0]; parts = [{ text: `Best bet: ${top.name}, a ${top.walk_minutes} minute walk. Forecast about ${top.forecast_open_spaces} of ${top.capacity} open (${top.forecast_percent_full}% full).\nPLACES: ${top.id}` }]; }
  else if (found) parts = [{ functionCall: { name: "plan_parking", args: { building_id: found.candidates[0].id, day_of_week: 3, class_time: "14:00" } } }];
  else parts = [{ functionCall: { name: "find_place", args: { query: "hancock" } } }];
  return { content: { role: "model", parts } };
}
async function onPaused({ requestId, request }) {
  const fulfill = (responseCode, headers, body = "") => send("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: headers, body: Buffer.from(body).toString("base64") });
  if (request.method === "OPTIONS") return fulfill(204, CORS);
  if (request.url.endsWith("/functions/v1/advisor")) {
    mock.advisorRequests.push(request);
    if (mock.advisorMode === "down") return fulfill(503, CORS, JSON.stringify({ error: "quota" }));
    if (mock.advisorMode === "empty") return fulfill(200, [...CORS, { name: "content-type", value: "application/json" }], JSON.stringify({ content: { role: "model", parts: [{ text: "" }] } }));
    return fulfill(200, [...CORS, { name: "content-type", value: "application/json" }], JSON.stringify(advisorTurn(JSON.parse(request.postData))));
  }
  mock.requests.push(request);
  if (mock.mode === "down") return fulfill(503, CORS, "down");
  const rows = mock.mode === "bad" ? [{ ...mock.rows[0], occupied: 99999 }] : mock.rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  return fulfill(200, [...CORS, { name: "content-type", value: "application/json" }], JSON.stringify(rows));
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${DIR}${OUT}-${name}.png`, Buffer.from(r.result.data, "base64")); };
// scrollIntoView first: with 85 lots the list view scrolls, and a click's page coordinates must
// land on the actual element on screen, not wherever its (possibly off-screen) rect used to be.
const center = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const click = async (sel) => { const c = await center(sel); if (!c) throw new Error("no element " + sel); for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: "left", clickCount: 1 }); await sleep(120); };
let failures = 0;
const check = (label, cond, extra = "") => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`); };
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
// The map's own state (zoom/center) lives inside MapLibre, not in per-feature DOM nodes like the
// old SVG map - src/ui/map.ts exposes the live instance at window.__hokiepark_map for exactly this.
const mapZoom = () => ev(`window.__hokiepark_map?.getZoom()`);
const mapCenter = () => ev(`(()=>{const c=window.__hokiepark_map?.getCenter();return c&&[c.lng,c.lat]})()`);

await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 2, mobile: +W < 500 });
if (LIVE) await send("Fetch.enable", { patterns: [{ urlPattern: "https://smoke.supabase.co/*" }] });
const URL_ = APP;
await send("Page.navigate", { url: URL_ });
// The map needs a network round-trip for its style/tiles/fonts (OpenFreeMap), unlike the old
// hand-drawn SVG map which rendered instantly from bundled data - give it real time to load.
const mapLoaded = await waitFor(async () => (await ev(`window.__hokiepark_map?.loaded()`)) === true, 15000);
check("map loaded (style + tiles from OpenFreeMap)", mapLoaded);
await sleep(300);
await shot("1-map");

const mapFillsView = await ev(`(()=>{const m=document.getElementById('map').getBoundingClientRect();const v=document.getElementById('view-map').getBoundingClientRect();return Math.abs(m.width-v.width)<1&&Math.abs(m.height-v.height)<1&&m.height>window.innerHeight*0.6})()`);
check("map fills the full available map view", mapFillsView);
check("2 garage + 85 lot markers", (await ev(`document.querySelectorAll('.marker-garage').length`)) === 2 && (await ev(`document.querySelectorAll('.marker-lot').length`)) === 85);
check("non-ADA lot pins are hidden at the zoomed-out home view (decluttered)", (await ev(`getComputedStyle(document.querySelector('.marker-lot:not(.has-ada)')).display`)) === "none");

// tap a garage marker
await click('.marker-garage[data-id="perry-street"]');
await sleep(800);
check("tap garage opens sheet", (await ev(`document.getElementById('sheet').hidden`)) === false);
check("sheet title is Perry Street Garage", (await ev(`document.getElementById('sheet-title')?.textContent`)) === "Perry Street Garage");
// REGRESSION (found at 375x667): an open bottom sheet must never cover the map controls. Each control's centre must be
// the control itself, not the sheet floating over it.
for (const cid of ["zoom-in", "zoom-out", "locate-me", "zoom-reset"]) {
  const uncovered = await ev(`(()=>{const b=document.getElementById(${JSON.stringify(cid)});if(!b)return null;const r=b.getBoundingClientRect();const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!e&&b.contains(e)})()`);
  check(`open sheet does not cover the #${cid} button`, uncovered === true);
}
check("sheet has 5 level rows", (await ev(`document.querySelectorAll('#sheet .level').length`)) === 5);
await shot("2-garage-sheet");
await ev(`document.getElementById('sheet').scrollTop = 9999`); await shot("2b-garage-sheet-scrolled");

// close via button
await click('#sheet [data-close]');
check("close button hides sheet", (await ev(`document.getElementById('sheet').hidden`)) === true);
// selecting Perry Street Garage may have nudged the camera (it was near the sheet's edge) - a
// real map, unlike the old fixed SVG, actually moves; reset to a known view before the next tap.
await click('#zoom-reset'); await sleep(700);

// tap a lot marker with ADA
await click('.marker-lot[data-id="lot-squires"]');
await sleep(800);
check("lot sheet shows ADA note", (await ev(`document.querySelector('#sheet .ada-note')!==null`)));
await shot("3-lot-sheet");

// Open a building from the searchable text alternative. At overview zoom, a parking marker can
// legitimately overlap a building's centroid and takes click priority over the polygon beneath it.
await click('#sheet [data-close]');
await click('.tabbar [data-view="list"]');
await ev(`(()=>{const i=document.getElementById('list-q');i.value='burruss';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
check("building search finds Burruss Hall", (await ev(`document.querySelector('#list-results .row[data-kind="building"] strong')?.textContent`)) === "Burruss Hall");
await click('#list-results .row[data-kind="building"]');
await sleep(800);
check("building selection opens Burruss sheet w/ nearest parking", (await ev(`document.getElementById('sheet-title')?.textContent`)) === "Burruss Hall" && (await ev(`document.querySelectorAll('#sheet .rows li').length`)) === 3);
await shot("4-building-sheet");

// list -> fly-to
await click('#sheet [data-close]');
await click('#zoom-reset');
await sleep(700);
await click('.tabbar [data-view="list"]');
await shot("5-list");
await ev(`(()=>{const i=document.getElementById('list-q');i.value='squ';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const rows = await ev(`document.querySelectorAll('#list-results .row').length`);
check("search 'squ' narrows list", rows >= 1 && rows < 5, `rows=${rows}`);
await ev(`(()=>{const i=document.getElementById('list-q');i.value='zzzz';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
check("no-match empty state", (await ev(`document.querySelector('#list-results .state-msg')?.textContent`))?.includes("No garages, lots, or buildings match"));
await ev(`(()=>{const i=document.getElementById('list-q');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const zoomBefore = await mapZoom();
await click('#list-results .row[data-id="lot-coliseum-west"]');
await sleep(900);
check("list selection returns to map with sheet", (await ev(`document.getElementById('view-map').hidden`)) === false && (await ev(`document.getElementById('sheet-title')?.textContent`)) === "Coliseum West");
check("fly-to zoomed in on the selected lot", (await mapZoom()) > zoomBefore + 1, `zoom ${zoomBefore} -> ${await mapZoom()}`);
await shot("6-flyto-coliseum");

// map selected row highlight in list
await click('.tabbar [data-view="list"]');
check("list highlights map selection", (await ev(`document.querySelector('#list-results .row.is-selected')?.dataset.id`)) === "lot-coliseum-west");
await click('.tabbar [data-view="map"]');

// zoom + pan
await click('#zoom-reset'); await sleep(700);
const z0 = await mapZoom();
await click('#zoom-in'); await click('#zoom-in');
await sleep(300);
const z1 = await mapZoom();
check("zoom-in buttons increase zoom", z1 > z0 + 0.5, `${z0.toFixed(2)} -> ${z1.toFixed(2)}`);
// A bottom sheet left open by the earlier steps covers most of a small phone's map, so gestures aimed at the map's centre
// would land on the sheet. Close it first (as a user would) and assert it really is closed.
if (!(await ev(`document.getElementById('sheet').hidden`))) { await click('#sheet [data-close]'); await sleep(300); }
check("sheet is closed before the map gesture tests", (await ev(`document.getElementById('sheet').hidden`)) === true);
const centerA = await mapCenter();
const m = await center('#map');
const hit = await ev(`(()=>{const r=document.getElementById('map').getBoundingClientRect();const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!e && document.getElementById('map').contains(e)})()`);
check("the map's centre is actually the map (nothing floats over it)", hit === true);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: m.x, y: m.y, button: "left", clickCount: 1 });
for (let i = 1; i <= 8; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: m.x + i * 12, y: m.y + i * 6, button: "left" });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: m.x + 96, y: m.y + 48, button: "left", clickCount: 1 });
const centerB = await mapCenter();
check("drag pans (center moved)", centerA[0] !== centerB[0] || centerA[1] !== centerB[1], `${centerA} -> ${centerB}`);
check("drag did not open a sheet", (await ev(`document.getElementById('sheet').hidden`)) === true);
const zBeforeWheel = await mapZoom();
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: m.x, y: m.y, deltaX: 0, deltaY: -300 });
await sleep(300);
check("wheel zooms in", (await mapZoom()) > zBeforeWheel, `${zBeforeWheel.toFixed(2)} -> ${(await mapZoom()).toFixed(2)}`);
await shot("7-zoomed");
await click('#zoom-reset'); await sleep(700);

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
// wait for the pending "Checking the data..." bubble to be replaced (the advisor path adds a network hop before the fallback answers)
const botIdle = async () => { await sleep(120); await waitFor(async () => !(await ev(`!!document.querySelector('#chat-log .msg.pending')`)), 8000); };
const chips = await ev(`document.querySelectorAll('#chat-suggest .chip').length`);
check("3 starter chips before the first question", chips === 3);

// Ask by typing, so these checks don't depend on where the chips happen to sit.
const say = async (q) => {
  await ev(`(()=>{const i=document.getElementById('chat-q');i.value=${JSON.stringify(q)};})()`);
  await ev(`document.getElementById('chat-form').requestSubmit()`);
  await botIdle();
  return botText();
};
let t;
if (!LIVE) { // the live build turns the advisor on: its answers come from Gemini, so exact wording isn't ours to assert
t = await say("Which garage has the most open spots right now?");
check("Q3 most open garage = North End Center 355 of 800", /North End Center Garage has the most open spaces right now: 355 of 800/.test(t), JSON.stringify(t?.slice(0, 90)));

// The starter bar is a cold-start aid: it must get out of the way once the chat has begun.
check("starter chips hidden after the first question", (await ev(`document.getElementById('chat-suggest').hidden`)) === true);

t = await say("Where's the closest open parking to Squires Student Center?");
check("Q1 closest parking to Squires names a garage + lot", /Closest parking to Squires Student Center/.test(t) && /North End Center Garage: 355 of 800/.test(t) && /lot/.test(t), JSON.stringify(t?.slice(0, 120)));

// Follow-ups replace the starter bar, drawn from what that answer referenced, newest answer only.
const ups = await ev(`[...document.querySelectorAll('.followups .chip')].map(b=>b.textContent)`);
check("follow-up chips offered under the latest answer", ups.length > 0 && ups.length <= 3, JSON.stringify(ups));
check("follow-ups reference what the answer named", ups.some((q) => /North End Center Garage|Squires|Alumni Mall/.test(q)), JSON.stringify(ups));
check("only one follow-up row exists", (await ev(`document.querySelectorAll('.followups').length`)) === 1);
const beforeUps = JSON.stringify(ups);
await click('.followups .chip'); await botIdle();
check("tapping a follow-up asks it and refreshes the chips",
  (await ev(`document.querySelectorAll('.followups').length`)) === 1 &&
  JSON.stringify(await ev(`[...document.querySelectorAll('.followups .chip')].map(b=>b.textContent)`)) !== beforeUps);

t = await say("Is there accessible parking near Cassell Coliseum?");
check("Q2 ADA near Cassell mentions Coliseum West 12 spaces", /Coliseum West lot/.test(t) && /12 designated accessible spaces/.test(t), JSON.stringify(t?.slice(0, 120)));
await shot("8b-ask-answers");
}
// typed question via input + form submit
await ev(`(()=>{const i=document.getElementById('chat-q');i.value='is perry street garage full?';})()`);
await ev(`document.getElementById('chat-form').requestSubmit()`); await botIdle();
t = await botText();
check("typed question answered with level rows", /Level 1 - Commuter & graduate: 0 open of 250 \(Full\)/.test(t));
// show on map hand-off
await click('#chat-log .msg.bot:last-child .ref');
await sleep(900);
check("'Show on map' returns to map with sheet open", (await ev(`document.getElementById('view-map').hidden`)) === false && (await ev(`document.getElementById('sheet').hidden`)) === false, await ev(`document.getElementById('sheet-title')?.textContent`));
await shot("8c-ask-to-map");
// Plan tab: destination + day + class time + permit -> forecast cards (Databricks predictions.json), permit rules respected
await click('.tabbar [data-view="plan"]'); await sleep(200); await shot("8d-plan");
check("Plan tab shows the form and 4 tabs exist", (await ev(`!document.getElementById('view-plan').hidden && !!document.getElementById('plan-form')`)) && (await ev(`document.querySelectorAll('.tabbar button').length`)) === 4);
await ev(`(()=>{const i=document.getElementById('plan-bldg');i.value='Hancock Hall';i.dispatchEvent(new Event('change'));document.getElementById('plan-day').value='3';document.getElementById('plan-time').value='14:00';})()`);
await ev(`document.getElementById('plan-form').requestSubmit()`); await sleep(250);
check("Plan without a permit asks for one and recommends nothing", /Choose your permit/.test(await ev(`document.getElementById('plan-out').innerText`)) && (await ev(`document.querySelectorAll('#plan-out .plan-card').length`)) === 0);
await click('#plan-permit-chips [data-permit="cg"]'); await sleep(300);
const planText = await ev(`document.getElementById('plan-out').innerText`);
check("choosing a permit re-runs the plan and lists 1-3 recommendations", (await ev(`document.querySelectorAll('#plan-out .plan-list:first-of-type .plan-card, #plan-out ol .plan-card').length`)) >= 1, JSON.stringify(planText.slice(0, 120)));
await shot("8e-plan-results");
check("plan says 2:00 PM Wednesday, arriving 1:45 PM, and labels the forecast simulated", /2:00 PM Wednesday/.test(planText) && /1:45 PM/.test(planText) && /simulated/i.test(planText) && /not measured occupancy/i.test(planText), JSON.stringify(planText.slice(0, 160)));
check("a plain Commuter permit is not sent to Perry Street Garage", !/Perry Street Garage/.test(await ev(`document.getElementById('plan-out').innerText`)));
check("the permit choice synced to the Map tab's picker", /Commuter\/Graduate/.test(await ev(`document.querySelector('.permit-chip')?.innerText || ''`)));
await ev(`document.querySelector('#plan-out ol .ref').click()`); await sleep(900);
check("Plan 'Show on map' opens the map with a sheet", (await ev(`document.getElementById('view-map').hidden`)) === false && (await ev(`document.getElementById('sheet').hidden`)) === false);
// typed plan question in Ask
await click('.tabbar [data-view="ask"]');
await ev(`(()=>{const i=document.getElementById('chat-q');i.value='I have a 2pm class in Hancock Hall on Wednesday, where do I park?';})()`);
await ev(`document.getElementById('chat-form').requestSubmit()`); await sleep(350);
t = await botText();
check("Ask answers a plan-ahead question with a forecast and the simulated disclaimer", /Parking for a 2:00 PM Wednesday class at Hancock Hall/.test(t) && /SIMULATED/.test(t), JSON.stringify(t?.slice(0, 140)));
// leave the app as we found it: no permit chosen, back on the map, nothing selected
await click('.tabbar [data-view="plan"]');
await click('#plan-permit-chips [data-permit="cg"]'); await sleep(200);
check("cleanup: permit cleared", (await ev(`document.querySelectorAll('#plan-permit-chips .is-on').length`)) === 0);
await click('.tabbar [data-view="map"]'); await sleep(200);
if ((await ev(`document.getElementById('sheet').hidden`)) === false) { await click('.sheet-close, #sheet [data-close], #sheet button[aria-label*="Close"]').catch(() => {}); }
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
  // The app shell (this HTML/JS/CSS) is precached and works offline; the map's live basemap
  // tiles are not (that's the deliberate tradeoff for a real, good-looking map - see ui/map.ts).
  // So offline should: still boot, show a clear "needs a connection" state on the Map tab, and
  // keep the List and Ask tabs fully working from the bundled data.
  await send("Network.enable"); await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send("Page.reload"); await sleep(1500);
  check("PWA: app shell loads OFFLINE from cache", await ev(`!!document.getElementById('app')`));
  const offlineMapSettled = await waitFor(async () => (await ev(`!!document.querySelector('.map-offline') || window.__hokiepark_map?.loaded() === true`)), 12000);
  check("PWA: Map tab shows an offline message or a fully cached map, never a blank partial map", offlineMapSettled);
  await shot("9-offline");
  await click('.tabbar [data-view="list"]');
  check("PWA: List tab still works OFFLINE (bundled data, no network needed)", (await ev(`document.querySelectorAll('#list-results .row').length`)) > 80);
  await click('.tabbar [data-view="ask"]');
  check("PWA: Ask tab still works OFFLINE", (await ev(`document.querySelectorAll('.chip').length`)) === 3);
  await click('.tabbar [data-view="map"]');
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
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

// ---- chip + live feed ----
const chipText = () => ev(`document.getElementById('sync').textContent`);
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
  mock.rows.find((r) => r.garage_id === "perry-street" && r.level_index === 1).occupied = 260; // 230 -> 260: Perry open 310 -> 280
  check("live: DB change updates the map marker", await waitFor(async () => /280 of 1350/.test(await markerLabel("perry-street"))), await markerLabel("perry-street"));
  await audit("after live update");

  // 2) an open sheet updates in place and keeps its scroll position
  await click('#zoom-reset'); await sleep(700); // the audit leaves the map zoomed on the last garage; Perry's marker would be off-screen
  await click('.marker-garage[data-id="perry-street"]'); await sleep(700);
  const scrollable = await ev(`(()=>{const s=document.getElementById('sheet');return s.scrollHeight>s.clientHeight+40})()`);
  if (scrollable) await ev(`document.getElementById('sheet').scrollTop = 120`);
  const before = await ev(`document.getElementById('sheet').scrollTop`);
  mock.rows.find((r) => r.garage_id === "perry-street" && r.level_index === 0).occupied = 200; // 250 -> 200: Perry open 280 -> 330
  check("live: open sheet total updates without closing", await waitFor(async () => (await ev(`document.querySelector('#sheet .big')?.innerText`)) === "330"), await ev(`document.querySelector('#sheet .big')?.innerText`));
  if (scrollable) check("live: sheet keeps its scroll position across an update", Math.abs((await ev(`document.getElementById('sheet').scrollTop`)) - before) < 4, `before=${before}`);
  check("live: sheet is still open and titled", (await ev(`document.getElementById('sheet-title')?.textContent`)) === "Perry Street Garage");
  await click('#sheet [data-close]');

  // 3) outage: last known counts stay, chip warns, recovery is automatic
  expectFailures = true;
  mock.mode = "down";
  check("outage: chip shows Offline", await waitFor(async () => (await chipText()) === "Offline"), await chipText());
  check("outage: last known counts stay on screen", /330 of 1350/.test(await markerLabel("perry-street")), await markerLabel("perry-street"));
  await shot("10-offline-chip");
  mock.mode = "ok";
  check("outage: recovers to Live by itself (backoff)", await waitFor(async () => /^Live/.test(await chipText()), 20000), await chipText());

  // 4) malformed payload is rejected wholesale
  mock.mode = "bad";
  check("bad payload: chip shows Offline (rejected)", await waitFor(async () => (await chipText()) === "Offline"), await chipText());
  check("bad payload: counts unchanged (all-or-nothing)", /330 of 1350/.test(await markerLabel("perry-street")), await markerLabel("perry-street"));
  mock.mode = "ok";
  check("bad payload: recovers to Live", await waitFor(async () => /^Live/.test(await chipText()), 20000), await chipText());
  expectFailures = false;
  await audit("after recovery");
  await shot("11-live-recovered");

  // 5) the Gemini advisor (mocked): AI answers are badged, the browser runs the tools, a failure falls back visibly
  mock.advisorMode = "ok";
  await click('.tabbar [data-view="ask"]'); await sleep(200);
  const say = async (q) => { await ev(`(()=>{const i=document.getElementById('chat-q');i.value=${JSON.stringify(q)};})()`); await ev(`document.getElementById('chat-form').requestSubmit()`); };
  const lastBot = () => ev(`(()=>{const m=[...document.querySelectorAll('#chat-log .msg.bot')].pop();return m?{text:m.innerText,src:m.querySelector('.src')?.textContent||'',pending:m.classList.contains('pending'),refs:m.querySelectorAll('button.ref').length}:null})()`);
  const settled = async () => { await waitFor(async () => !(await lastBot()).pending, 8000); return lastBot(); };
  check("advisor: greeting names the advisor and the Google notice; 3 advisor suggestions", /parking advisor/.test(await ev(`document.querySelector('#chat-log .msg.bot')?.innerText||''`)) && /Gemini/.test(await ev(`document.querySelector('#chat-log .msg.bot')?.innerText||''`)) && (await ev(`document.querySelectorAll('.chip').length`)) === 3);
  await say("2pm class at Hancock Hall on Wednesday, where do I park?");
  let m = await settled();
  check("advisor: with no permit it asks for one (tool error handled), badged AI advisor", m.src === "AI advisor" && /Which permit do you hold/.test(m.text), JSON.stringify(m).slice(0, 200));
  await click('.tabbar [data-view="plan"]'); await click('#plan-permit-chips [data-permit="cg"]'); await click('.tabbar [data-view="ask"]');
  await say("2pm class at Hancock Hall on Wednesday, where do I park?");
  m = await settled();
  check("advisor: with a permit the browser ran the tools and the answer is grounded and badged", m.src === "AI advisor" && /Best bet: .* minute walk\. Forecast about \d+ of \d+ open/.test(m.text) && /SIMULATED/.test(m.text) && m.refs >= 1, JSON.stringify(m).slice(0, 260));
  const last = mock.advisorRequests.at(-1);
  const sent = JSON.parse(last.postData);
  check("advisor: requests carry only the conversation + context (no system prompt, no tools, no key)", !("systemInstruction" in sent) && !("tools" in sent) && Object.keys(sent).sort().join() === "contents,context" && !/AIza|GEMINI/.test(last.postData), Object.keys(sent).join());
  check("advisor: context carries the saved permit", JSON.stringify(sent.context.permits) === '["cg"]', JSON.stringify(sent.context));
  expectFailures = true;
  mock.advisorMode = "down";
  await say("2pm class at Hancock Hall on Wednesday, where do I park?");
  m = await settled();
  check("advisor down: falls back to the rule-based answer, visibly badged Basic answer", m.src === "Basic answer" && /Parking for a 2:00 PM Wednesday class at Hancock Hall/.test(m.text), JSON.stringify(m).slice(0, 220));
  mock.advisorMode = "empty";
  expectFailures = false;
  await shot("12-advisor");
  await click('.tabbar [data-view="plan"]'); await click('#plan-permit-chips [data-permit="cg"]'); await click('.tabbar [data-view="map"]');
}

// horizontal overflow check
check("no horizontal page overflow", (await ev(`document.documentElement.scrollWidth <= window.innerWidth`)));

const unexpected = errors.filter((e) => !e.expected);
check("zero console errors/warnings", unexpected.length === 0, unexpected.map((e) => e.text).join(" | "));
console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} at ${OUT}`);
ws.close(); proc.kill(); server.close();
process.exit(failures ? 1 : 0);
