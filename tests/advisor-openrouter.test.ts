import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter, handle, type Deps, type Env } from "../supabase/functions/advisor/handler.ts";
import { fromOpenAiMessage, toOpenAiMessages, toOpenAiTools, type Content } from "../supabase/functions/advisor/providers.ts";
import { TOOL_DECLARATIONS } from "../src/lib/advisor-spec.ts";
import { createAdvisor, httpTransport, withAdvisor } from "../src/lib/advisor.ts";
import { answerQuestion } from "../src/lib/assistant.ts";
import { searchPlaces } from "../src/lib/advisor-tools.ts";

const KEY = "sk-or-v1-test-secret-key-DO-NOT-LEAK";
const env: Env = { OPENROUTER_API_KEY: KEY };
const context = { now: { dow: 3, minute: 540 }, permits: ["cg"], ada: false };
const good = { contents: [{ role: "user", parts: [{ text: "2pm class at Torgersen" }] }], context };
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("https://x.supabase.co/functions/v1/advisor", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const ok = (message: unknown, model = "vendor/model:free") => Response.json({ id: "gen-1", model, choices: [{ finish_reason: "stop", message }] });

interface Sent { url: string; init: RequestInit; body: any }
function deps(reply: (n: number) => Response | Promise<Response> = () => ok({ role: "assistant", content: "hi" })) {
  const sent: Sent[] = [];
  const d: Deps = {
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
      return reply(sent.length);
    }) as unknown as typeof fetch,
    now: () => 0,
    limiter: createLimiter(),
    sleep: async () => {},
  };
  return { d, sent };
}

test("OpenRouter request: OpenAI-compatible endpoint, Bearer key + attribution headers, system prompt + tools in OpenAI format, key only in the header", async () => {
  const { d, sent } = deps();
  const res = await handle(post(good), env, d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { content: { role: "model", parts: [{ text: "hi" }] } });
  const s = sent[0]!;
  assert.equal(s.url, "https://openrouter.ai/api/v1/chat/completions");
  const h = s.init.headers as Record<string, string>;
  assert.equal(h.authorization, `Bearer ${KEY}`);
  assert.equal(h["x-title"], "HokiePark");
  assert.match(h["http-referer"]!, /^https:\/\/heuyz14\.github\.io/);
  assert.ok(!JSON.stringify(s.body).includes(KEY) && !s.url.includes(KEY));
  assert.equal(s.body.model, "openrouter/free", "default model id");
  assert.equal(s.body.models, undefined);
  assert.equal(s.body.messages[0].role, "system");
  assert.match(s.body.messages[0].content, /MUST come from tool results/);
  assert.deepEqual(s.body.messages[1], { role: "user", content: "2pm class at Torgersen" });
  assert.equal(s.body.tools.length, TOOL_DECLARATIONS.length);
  assert.deepEqual(s.body.tools[0], { type: "function", function: { name: TOOL_DECLARATIONS[0]!.name, description: TOOL_DECLARATIONS[0]!.description, parameters: JSON.parse(JSON.stringify(TOOL_DECLARATIONS[0]!.parameters)) } });
  assert.equal(s.body.tool_choice, "auto");
});

test("OPENROUTER_MODEL: one id uses `model`; several use OpenRouter's own fallback list `models` (max 3); referer is configurable", async () => {
  const one = deps();
  await handle(post(good), { ...env, OPENROUTER_MODEL: "qwen/qwen3.8-27b:free" }, one.d);
  assert.deepEqual([one.sent[0]!.body.model, one.sent[0]!.body.models], ["qwen/qwen3.8-27b:free", undefined]);
  const many = deps();
  await handle(post(good), { ...env, OPENROUTER_MODEL: " a:free, b:free ,c:free,d:free", OPENROUTER_REFERER: "https://example.org/" }, many.d);
  assert.deepEqual([many.sent[0]!.body.model, many.sent[0]!.body.models], [undefined, ["a:free", "b:free", "c:free"]]);
  assert.equal((many.sent[0]!.init.headers as Record<string, string>)["http-referer"], "https://example.org/");
});

test("provider selection: OpenRouter wins when its key is set; Gemini still works alone; neither -> not_configured", async () => {
  const both = deps();
  await handle(post(good), { OPENROUTER_API_KEY: KEY, GEMINI_API_KEY: "g" }, both.d);
  assert.match(both.sent[0]!.url, /openrouter\.ai/);
  const g = deps(() => Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "g" }] } }] }));
  const r = await handle(post(good), { GEMINI_API_KEY: "g" }, g.d);
  assert.match(g.sent[0]!.url, /generativelanguage/);
  assert.equal(r.status, 200);
  assert.equal((await handle(post(good), {}, deps().d)).status, 500);
});

test("translation: Gemini-style history -> OpenAI messages with matching tool-call ids (assistant tool_calls, then tool results, in order)", () => {
  const contents: Content[] = [
    { role: "user", parts: [{ text: "class at torg" }] },
    { role: "model", parts: [{ functionCall: { name: "find_place", args: { query: "torg" } }, thoughtSignature: "ignored-here" }] },
    { role: "user", parts: [{ functionResponse: { name: "find_place", response: { result: { ok: true, candidates: [{ id: "b0174" }] } } } }] },
    { role: "model", parts: [{ text: "checking" }, { functionCall: { name: "plan_parking", args: { building_id: "b0174" } } }, { functionCall: { name: "permit_check", args: { place_id: "lot-x" } } }] },
    { role: "user", parts: [{ functionResponse: { name: "permit_check", response: { result: { ok: false } } } }, { functionResponse: { name: "plan_parking", response: { result: { ok: true } } } }] },
  ];
  const m = toOpenAiMessages(contents, context as any);
  assert.deepEqual(m.map((x) => x.role), ["system", "user", "assistant", "tool", "assistant", "tool", "tool"]);
  const a1 = m[2] as any, t1 = m[3] as any, a2 = m[4] as any;
  assert.equal(a1.content, null);
  assert.equal(a1.tool_calls[0].function.name, "find_place");
  assert.equal(a1.tool_calls[0].function.arguments, '{"query":"torg"}');
  assert.equal(t1.tool_call_id, a1.tool_calls[0].id);
  assert.equal(a2.content, "checking");
  const [planId, permitId] = a2.tool_calls.map((c: any) => c.id);
  assert.equal(new Set([a1.tool_calls[0].id, planId, permitId]).size, 3, "ids are unique");
  assert.deepEqual([(m[5] as any).tool_call_id, (m[6] as any).tool_call_id], [permitId, planId], "results are matched to calls by tool name, not by order");
  assert.deepEqual(JSON.parse((m[3] as any).content), { result: { ok: true, candidates: [{ id: "b0174" }] } });
  // deterministic: the same history always yields the same ids (each request re-derives them)
  assert.deepEqual(toOpenAiMessages(contents, context as any), m);
});

test("translation: tools are OpenAI function tools; replies map back to text + functionCall parts; bad arguments become {}", () => {
  assert.ok(toOpenAiTools().every((t) => t.type === "function" && t.function.parameters));
  assert.deepEqual(fromOpenAiMessage({ role: "assistant", content: "Take lot X.\nPLACES: lot-x" }), [{ text: "Take lot X.\nPLACES: lot-x" }]);
  assert.deepEqual(fromOpenAiMessage({ role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "find_place", arguments: '{"query":"torg"}' } }] }), [{ functionCall: { name: "find_place", args: { query: "torg" } } }]);
  assert.deepEqual(fromOpenAiMessage({ content: "", tool_calls: [{ function: { name: "find_place", arguments: "{oops" } }] }), [{ functionCall: { name: "find_place", args: {} } }]);
  assert.deepEqual(fromOpenAiMessage({ content: "x", tool_calls: [{ function: { name: "rm_rf", arguments: "{}" } }] }), [{ text: "x" }], "unknown tools are dropped");
  assert.deepEqual(fromOpenAiMessage({ content: "  " }), []);
  assert.deepEqual(fromOpenAiMessage(null), []);
});

test("a model turn with tool calls round-trips through the relay", async () => {
  const { d } = deps(() => ok({ role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "find_place", arguments: '{"query":"torgersen"}' } }] }));
  const j = (await (await handle(post(good), env, d)).json()) as any;
  assert.deepEqual(j.content.parts, [{ functionCall: { name: "find_place", args: { query: "torgersen" } } }]);
});

test("error mapping: 401/403 -> 502, 402 credits -> 502 with a hint, 429 -> 503 quota, 5xx retried once then 502, 200-with-error -> 502, empty -> 502; the key never leaks", async () => {
  const errBody = (status: number, code: number, message: string) => new Response(JSON.stringify({ error: { code, message } }), { status });
  const run = async (reply: (n: number) => Response | Promise<Response>) => { const { d, sent } = deps(reply); const r = await handle(post(good), env, d); return { r, j: (await r.json()) as any, sent }; };

  let x = await run(() => errBody(401, 401, `No auth credentials found for ${KEY}`));
  assert.deepEqual([x.r.status, x.j.error, x.j.upstream_status, x.j.upstream_code], [502, "upstream_rejected", 401, "401"]);
  assert.ok(!JSON.stringify(x.j).includes(KEY) && /\[redacted\]/.test(x.j.upstream_message));
  x = await run(() => errBody(402, 402, "Insufficient credits"));
  assert.deepEqual([x.r.status, x.j.upstream_status], [502, 402]);
  assert.match(x.j.hint, /insufficient credits/i);
  x = await run(() => errBody(429, 429, "Rate limit exceeded: free-models-per-day"));
  assert.deepEqual([x.r.status, x.j.error, x.j.upstream_code], [503, "quota", "429"]);
  assert.equal(x.sent.length, 1, "a rate limit is not retried (it would burn more of the daily budget)");
  x = await run((n) => (n === 1 ? errBody(503, 503, "provider down") : ok({ role: "assistant", content: "recovered" })));
  assert.equal(x.r.status, 200);
  assert.equal(x.sent.length, 2, "one retry on 502/503");
  x = await run(() => errBody(503, 503, "provider down"));
  assert.deepEqual([x.r.status, x.sent.length], [502, 2]);
  x = await run(() => Response.json({ error: { code: 502, message: "Provider returned error" } }));
  assert.deepEqual([x.r.status, x.j.error], [502, "upstream_rejected"]);
  x = await run(() => Response.json({ choices: [{ error: { code: 500, message: "boom" }, message: null }] }));
  assert.equal(x.j.error, "upstream_rejected");
  x = await run(() => Response.json({ choices: [{ message: { role: "assistant", content: "" } }] }));
  assert.deepEqual([x.r.status, x.j.error], [502, "no_content"]);
  x = await run(() => new Response("<html>", { status: 200 }));
  assert.equal(x.j.error, "upstream_bad_json");
  x = await run(() => errBody(404, 404, "No endpoints found matching your data policy"));
  assert.match(x.j.hint, /privacy settings/);
});

test("network failure -> 504 upstream_timeout", async () => {
  const { d } = deps();
  d.fetch = (async () => { throw new DOMException("timeout", "TimeoutError"); }) as typeof fetch;
  assert.equal((await handle(post(good), env, d)).status, 504);
});

// ---------- full chain for the THREE SPEC QUESTIONS: agent -> relay -> fake OpenRouter model -> real tools ----------
function fakeModel() {
  // A well-behaved OpenAI-style model: picks tools from the conversation, then writes advice from the tool results shown to it.
  const toolMsgs = (m: any[]) => m.filter((x) => x.role === "tool").map((x) => ({ id: x.tool_call_id, ...JSON.parse(x.content).result }));
  return (async (_url: string, init: RequestInit) => {
    const { messages } = JSON.parse(String(init.body)) as { messages: any[] };
    const q: string = messages.find((m) => m.role === "user").content;
    const results = toolMsgs(messages);
    const call = (name: string, args: unknown) => ok({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    const last = results.at(-1);
    if (/most open/i.test(q)) {
      if (!last) return call("garages_now", {});
      const t = last.most_open;
      return ok({ role: "assistant", content: `${t.name} has the most open spaces right now: ${t.open_spaces}.\nPLACES: ${t.id}` });
    }
    if (/accessible/i.test(q)) {
      if (!results.length) return call("find_place", { query: "cassell" });
      if (!results.some((r) => r.lots)) return call("accessible_parking", { place_id: results[0].candidates[0].id });
      const lot = last.lots[0];
      return ok({ role: "assistant", content: `Yes. ${lot.name} is ${lot.walk_minutes} minutes away with ${lot.designated_accessible_spaces} designated accessible spaces.\nPLACES: ${lot.id}` });
    }
    if (!results.length) return call("find_place", { query: "squires student" });
    if (!results.some((r) => r.nearest_with_open_spaces)) return call("parking_now", { place_id: results[0].candidates[0].id });
    const n = last.nearest_with_open_spaces[0];
    return ok({ role: "assistant", content: `Closest open parking to Squires: ${n.name}, ${n.walk_minutes} minutes away, with ${n.current_open_spaces} open of ${n.capacity}.\nPLACES: ${n.id}` });
  }) as unknown as typeof fetch;
}
const stack = () => {
  const d: Deps = { fetch: fakeModel(), now: () => 0, limiter: createLimiter(), sleep: async () => {} };
  const transport = httpTransport({ url: "https://x.supabase.co/functions/v1/advisor", anonKey: "k" }, (async (u: string, i: RequestInit) => handle(new Request(u, i), env, d)) as unknown as typeof fetch);
  return createAdvisor({ transport, getContext: () => ({ now: { dow: 6, minute: 900 }, permits: [], ada: false }) });
};
const numbers = (s: string) => (s.match(/\d+/g) ?? []).map(Number);

test("SPEC Q3 through OpenRouter: 'which garage has the most open spots' answers with the rule-based assistant's garage and number", async () => {
  const r = await stack().ask("Which garage has the most open spots right now?");
  assert.ok(r.ok, JSON.stringify(r));
  const rule = answerQuestion("Which garage has the most open spots right now?").lines[0]!;
  assert.equal(r.lines[0]!.replace(/\.$/, ""), rule.replace(/ of \d+\.$/, "").replace(/\.$/, ""));
  assert.ok(r.refs.length === 1);
});

test("SPEC Q2 through OpenRouter: accessible parking near Cassell names the same lot and accessible-space count", async () => {
  const r = await stack().ask("Is there accessible parking near Cassell Coliseum?");
  assert.ok(r.ok, JSON.stringify(r));
  const rule = answerQuestion("Is there accessible parking near Cassell Coliseum?").lines.join("\n");
  const answerNums = numbers(r.lines[0]!);
  const lotName = r.lines[0]!.match(/Yes\. (.+?) is/)![1]!;
  assert.ok(rule.includes(lotName), lotName);
  assert.ok(rule.includes(`${answerNums.at(-1)} designated accessible spaces`), r.lines[0] ?? "");
});

test("SPEC Q1 through OpenRouter: closest open parking to Squires is a place with open spaces, with counts from the map's data", async () => {
  const r = await stack().ask("Where's the closest open parking to Squires Student Center?");
  assert.ok(r.ok, JSON.stringify(r));
  const rule = answerQuestion("Where's the closest open parking to Squires Student Center?").lines.join("\n");
  const name = r.lines[0]!.match(/Squires: (.+?), \d+ minutes/)![1]!;
  assert.ok(rule.includes(name), `${name} should appear in the rule-based answer:\n${rule}`);
  assert.ok(r.lines.some((l) => /demo data/i.test(l)));
});

test("failure paths degrade to the rule-based answer: rate limit, credits, timeout, malformed reply", async () => {
  const fallback = async () => ({ lines: ["rule-based"], refs: [] });
  for (const reply of [() => new Response(JSON.stringify({ error: { code: 429, message: "limit" } }), { status: 429 }), () => new Response(JSON.stringify({ error: { code: 402, message: "credits" } }), { status: 402 }), () => new Response("garbage", { status: 200 })]) {
    const d: Deps = { fetch: (async () => reply()) as unknown as typeof fetch, now: () => 0, limiter: createLimiter(), sleep: async () => {} };
    const transport = httpTransport({ url: "https://x/y", anonKey: "k" }, (async (u: string, i: RequestInit) => handle(new Request(u, i), env, d)) as unknown as typeof fetch);
    const a = await withAdvisor(fallback, createAdvisor({ transport, getContext: () => ({ now: { dow: 3, minute: 540 }, permits: [], ada: false }) }))("which garage has the most open spots");
    assert.deepEqual([a.lines, (a as any).source], [["rule-based"], "basic"]);
  }
  assert.ok(searchPlaces("cassell").length > 0);
});

test("RETRY: an overload hidden inside a 200 body (e.g. 'Upstream error from Nvidia') is retried ONCE, starting from a different model", async () => {
  const overloaded = () => Response.json({ error: { code: 503, message: "Upstream error from Nvidia: Service temporarily overloaded" } });
  const { d, sent } = deps((n) => (n === 1 ? overloaded() : ok({ role: "assistant", content: "recovered" })));
  const res = await handle(post(good), { ...env, OPENROUTER_MODEL: "a:free,b:free,c:free" }, d);
  assert.equal(res.status, 200);
  assert.deepEqual([sent.length, sent[0]!.body.models, sent[1]!.body.models], [2, ["a:free", "b:free", "c:free"], ["b:free", "c:free", "a:free"]]);
  const twice = deps(() => overloaded());
  const r2 = await handle(post(good), env, twice.d);
  assert.deepEqual([r2.status, twice.sent.length], [502, 2], "retried once, then reported");
  assert.match(((await r2.json()) as any).upstream_message, /Nvidia/);
});

test("RETRY: final errors are NOT retried (bad key, no credits, rate limit inside a 200 body); an empty reply is retried once", async () => {
  for (const code of [401, 402, 429]) {
    const { d, sent } = deps(() => Response.json({ error: { code, message: "final" } }));
    const res = await handle(post(good), env, d);
    assert.equal(sent.length, 1, `code ${code} must not be retried`);
    assert.equal(res.status, 502);
  }
  const empty = deps((n) => (n === 1 ? ok({ role: "assistant", content: "" }) : ok({ role: "assistant", content: "now it answers" })));
  assert.equal((await handle(post(good), env, empty.d)).status, 200);
  assert.equal(empty.sent.length, 2);
});
