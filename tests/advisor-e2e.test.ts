import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdvisor, httpTransport, withAdvisor, type Content } from "../src/lib/advisor.ts";
import type { AdvisorContext } from "../src/lib/advisor-spec.ts";
import { createLimiter, handle, type Deps } from "../supabase/functions/advisor/handler.ts";

/**
 * Full chain, no browser and no key: real agent loop -> real server handler -> a FAKE Gemini that behaves like a well-behaved
 * model (chooses tools from the conversation and writes advice from the tool results it is shown).
 */
const ctx: AdvisorContext = { now: { dow: 6, minute: 17 * 60 }, permits: ["cg"], ada: false };
const lastResult = (contents: Content[], tool: string) => {
  for (const c of [...contents].reverse()) for (const p of c.parts) if (p.functionResponse?.name === tool) return (p.functionResponse.response as { result: any }).result;
  return null;
};
const asked = (contents: Content[]) => contents.find((c) => c.role === "user")!.parts[0]!.text ?? "";

let calls = 0;
function fakeGemini(mode: "good" | "liar" | "down" = "good") {
  return (async (_url: string, init: RequestInit) => {
    calls++;
    if (mode === "down") return new Response("{}", { status: 429 });
    const { contents } = JSON.parse(String(init.body)) as { contents: Content[] };
    const found = lastResult(contents, "find_place");
    const plan = lastResult(contents, "plan_parking");
    let parts;
    if (plan) {
      const top = plan.recommended[0];
      parts = mode === "liar"
        ? [{ text: `Take ${top.name}, it has 9999 free spaces.\nPLACES: ${top.id}` }]
        : [{ text: `Best bet: ${top.name}, a ${top.walk_minutes} minute walk. Forecast about ${top.forecast_open_spaces} of ${top.capacity} open (${top.forecast_percent_full}% full). ${plan.check_sign.length ? "Nearby lots I can't confirm for your permit: check the sign." : ""}\nPLACES: ${top.id}` }];
    } else if (found) parts = [{ functionCall: { name: "plan_parking", args: { building_id: found.candidates[0].id, day_of_week: 3, class_time: "14:00" } }, thoughtSignature: "sig-e2e" }];
    else parts = [{ functionCall: { name: "find_place", args: { query: /torgersen/i.test(asked(contents)) ? "torgersen" : "hancock" } } }];
    return Response.json({ candidates: [{ content: { role: "model", parts } }] });
  }) as unknown as typeof fetch;
}

function stack(mode: "good" | "liar" | "down" = "good") {
  const deps: Deps = { fetch: fakeGemini(mode), now: () => 0, limiter: createLimiter() };
  const server = async (req: Request) => handle(req, { GEMINI_API_KEY: "k" }, deps);
  const transport = httpTransport({ url: "https://x.supabase.co/functions/v1/advisor", anonKey: "anon" }, (async (url: string, init: RequestInit) => server(new Request(url, init))) as unknown as typeof fetch);
  return createAdvisor({ transport, getContext: () => ctx });
}

test("E2E: a natural request becomes find_place -> plan_parking -> grounded advice, with the model's signature round-tripped", async () => {
  const r = await stack().ask("I've got a 2 o'clock class in Torgersen on Wednesday, where do I park?");
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.tools, [{ name: "find_place", ok: true }, { name: "plan_parking", ok: true }]);
  assert.match(r.lines[0]!, /Best bet: .* minute walk\. Forecast about \d+ of \d+ open \(\d+% full\)/);
  assert.equal(r.refs.length, 1);
  assert.ok(r.lines.some((l) => /SIMULATED/.test(l)));
});

test("E2E: a dishonest model is caught by the number guard and the chat falls back to the rule-based answer", async () => {
  const answer = await withAdvisor(async () => ({ lines: ["rule-based answer"], refs: [] }), stack("liar"))("2pm class in Torgersen wednesday");
  assert.deepEqual([answer.lines, (answer as { source?: string }).source, (answer as { reason?: string }).reason], [["rule-based answer"], "basic", "guard"]);
});

test("E2E: quota exhaustion (Gemini 429) degrades to the rule-based answer, not an error", async () => {
  const answer = await withAdvisor(async () => ({ lines: ["rule-based answer"], refs: [] }), stack("down"))("2pm class in Torgersen");
  assert.equal((answer as { source?: string }).source, "basic");
  assert.equal((answer as { reason?: string }).reason, "transport");
});
