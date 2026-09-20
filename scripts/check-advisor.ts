/**
 * Live check of the DEPLOYED advisor: runs the real agent loop from your machine against your Supabase `advisor` function and real Gemini.
 * Reads HOKIEPARK_SUPABASE_URL / _ANON_KEY (and optionally HOKIEPARK_ADVISOR_URL) from the environment (npm run check:advisor loads
 * .env.local) and never prints a key. Each scenario reports the tools the model chose, the answer, and whether the guards accepted it.
 * A "basic" result means the app would have fallen back to the rule-based assistant; the reason says why.
 */
import { createAdvisor, httpTransport } from "../src/lib/advisor.ts";
import { parseAdvisorConfig } from "../src/lib/advisor-config.ts";
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

// 1) reachability and secrets, before spending model calls
const ping = await fetch(c.url, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: c.anonKey, authorization: `Bearer ${c.anonKey}` },
  body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }], context: { now: { dow: 3, minute: 540 }, permits: [], ada: false } }),
}).catch((e) => die(`cannot reach the function: ${(e as Error).message}`));
const pingRes = ping as Response;
if (pingRes.status === 404) die("function not found (404). Deploy it: Supabase -> Edge Functions -> new function named 'advisor'.");
if (pingRes.status === 401) die("401: the function gateway rejected the key. New Supabase functions accept only sb_publishable_... keys: set HOKIEPARK_ADVISOR_KEY in .env.local to the Publishable key from Project Settings -> API Keys.");
if (pingRes.status === 500) die("500 not_configured: set the GEMINI_API_KEY secret on the function.");
if (pingRes.status === 502 || pingRes.status === 503 || pingRes.status === 504) die(`upstream problem (${pingRes.status}): check GEMINI_API_KEY, GEMINI_MODEL and your Gemini quota in Google AI Studio.`);
if (!pingRes.ok) die(`unexpected HTTP ${pingRes.status}`);
const pingBody = (await pingRes.json().catch(() => null)) as { content?: { parts?: unknown[] }; message?: string } | null;
if (typeof pingBody?.message === "string" && !pingBody.content) {
  die(`the function answered ${JSON.stringify(pingBody.message)}: that is Supabase's default placeholder, not the advisor. Open Edge Functions -> advisor -> editor, replace ALL of the code with supabase/functions/advisor/index.ts (pbcopy < that file), and click Deploy.`);
}
if (!Array.isArray(pingBody?.content?.parts)) die("the function responded, but not in the advisor's format. Re-paste supabase/functions/advisor/index.ts and redeploy.");
console.log("PASS  the advisor function is deployed and Gemini accepted the key");

// 2) real scenarios through the real agent loop and the real tools
const ctx = { now: { dow: 6, minute: 15 * 60 }, permits: ["cg" as const], ada: false };
const scenarios = [
  "I have a 2pm class in Hancock Hall on Wednesday. Where should I park?",
  "When should I arrive at Torgersen Hall for a 10am Tuesday class to still find a spot?",
  "Can I park at the Squires lot with my permit?",
  "What's the weather like in Blacksburg?", // should be declined politely, no tools
];
let ai = 0;
for (const q of scenarios) {
  const advisor = createAdvisor({ transport: httpTransport(c), getContext: () => ctx });
  const t0 = Date.now();
  const r = await advisor.ask(q);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nQ: ${q}`);
  if (r.ok) {
    ai++;
    console.log(`PASS  ai (${secs}s), tools: ${r.tools.map((t) => `${t.name}${t.ok ? "" : "(error)"}`).join(" -> ") || "none"}`);
    for (const l of r.lines.slice(0, -1)) console.log(`   ${l}`);
    if (r.refs.length) console.log(`   places: ${r.refs.map((x) => x.label).join(", ")}`);
  } else {
    console.log(`WARN  basic (${secs}s): the app would fall back. reason=${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
  }
}
console.log(`\n${ai}/${scenarios.length} scenarios answered by the advisor`);
if (ai === 0) die("no scenario was answered by the advisor. See reasons above (guard = the model wrote a number the tools did not supply).");
