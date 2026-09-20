/**
 * Live check of the DEPLOYED advisor: runs the real agent loop from your machine against your Supabase `advisor` function and the real
 * model behind it (OpenRouter, or Gemini). Reads HOKIEPARK_SUPABASE_URL / _ANON_KEY (and HOKIEPARK_ADVISOR_KEY / _URL if set) from the
 * environment (npm run check:advisor loads .env.local) and never prints a key.
 *
 * It asks the three example questions from the spec plus one plan-ahead question, prints the tools the model chose, its answer, and the
 * rule-based assistant's answer next to it so you can compare numbers. A "basic" result means the app would have fallen back; the reason says why.
 * Budget: roughly 12-16 model requests. OpenRouter's free models allow 50 requests/day (1,000 after a one-time $10 credit purchase).
 */
import { createAdvisor, httpTransport } from "../src/lib/advisor.ts";
import { parseAdvisorConfig } from "../src/lib/advisor-config.ts";
import { answerQuestion } from "../src/lib/assistant.ts";
import { parseLiveConfig } from "../src/lib/live-config.ts";

const die = (msg: string): never => {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
};

let cfg;
try {
  const live = parseLiveConfig(process.env.HOKIEPARK_SUPABASE_URL, process.env.HOKIEPARK_SUPABASE_ANON_KEY, process.env.HOKIEPARK_POLL_MS);
  cfg = parseAdvisorConfig("1", process.env.HOKIEPARK_ADVISOR_URL, live, process.env.HOKIEPARK_ADVISOR_KEY);
} catch (e) {
  die((e as Error).message);
}
if (!cfg) die("Set HOKIEPARK_SUPABASE_URL and HOKIEPARK_SUPABASE_ANON_KEY in .env.local first.");
const c = cfg!;
console.log(`function: ${new URL(c.url).host}${new URL(c.url).pathname}`);

// 1) is the ADVISOR deployed? An invalid body is rejected by the advisor code itself with a 400 JSON error and costs no model request.
const probe = await fetch(c.url, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: c.anonKey, authorization: `Bearer ${c.anonKey}` },
  body: "{}",
}).catch((e) => die(`cannot reach the function: ${(e as Error).message}`));
const pr = probe as Response;
const prText = await pr.text();
if (pr.status === 404) die("function not found (404). Deploy it: Supabase -> Edge Functions -> new function named 'advisor'.");
if (pr.status === 401) {
  die(`401 from Supabase before the advisor code ran: ${prText.slice(0, 220)}\n  - "Invalid JWT" / "UNAUTHORIZED..." with a publishable key: Edge Functions -> advisor -> Settings -> turn OFF "Verify JWT" (the advisor validates and rate-limits requests itself), then redeploy.\n  - "INVALID_API_KEY ... legacy": the function code is still the placeholder, or set HOKIEPARK_ADVISOR_KEY to the sb_publishable_ key.\n  - Alternatively remove HOKIEPARK_ADVISOR_KEY from .env.local so the legacy anon JWT is used (works when Verify JWT is ON).`);
}
if (pr.status === 200 && /"message"\s*:\s*"Hello/.test(prText)) die("the function answered with Supabase's default placeholder, not the advisor. Replace ALL the code in Edge Functions -> advisor with supabase/functions/advisor/index.ts (pbcopy < that file) and click Deploy.");
if (pr.status === 500 && /not_configured/.test(prText)) die("500 not_configured: set the OPENROUTER_API_KEY secret (or GEMINI_API_KEY) on the function, then redeploy.");
if (pr.status !== 400 || !/bad context|body must be an object/.test(prText)) die(`unexpected response from the function (HTTP ${pr.status}): ${prText.slice(0, 160)}`);
console.log("PASS  the advisor function is deployed (its own validation answered)");

// 2) real scenarios through the real agent loop and the real tools
const ctx = { now: { dow: 6, minute: 15 * 60 }, permits: [] as never[], ada: false };
const scenarios: { q: string; compare?: boolean }[] = [
  { q: "Where's the closest open parking to Squires Student Center?", compare: true },
  { q: "Is there accessible parking near Cassell Coliseum?", compare: true },
  { q: "Which garage has the most open spots right now?", compare: true },
  { q: "I have a 2pm class in Hancock Hall on Wednesday, commuter permit. Where should I park?" },
];
const PAUSE_MS = Number(process.env.ADVISOR_CHECK_PAUSE_MS ?? 6_000);
let ai = 0;
for (const [n, s] of scenarios.entries()) {
  if (n > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
  const advisor = createAdvisor({ transport: httpTransport(c), getContext: () => ctx });
  const t0 = Date.now();
  const r = await advisor.ask(s.q);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nQ: ${s.q}`);
  if (r.ok) {
    ai++;
    console.log(`PASS  ai (${secs}s), tools: ${r.tools.map((t) => `${t.name}${t.ok ? "" : "(error)"}`).join(" -> ") || "none"}`);
    for (const l of r.lines.slice(0, -1)) console.log(`   ${l}`);
  } else {
    console.log(`WARN  basic (${secs}s): the app would fall back. reason=${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
  }
  if (s.compare) {
    console.log("   rule-based assistant says:");
    for (const l of answerQuestion(s.q).lines.slice(0, 4)) console.log(`     ${l}`);
  }
}
console.log(`\n${ai}/${scenarios.length} scenarios answered by the advisor`);
if (ai === 0) die("no scenario was answered by the advisor. See reasons above (guard = the model wrote a number the tools did not supply).");
