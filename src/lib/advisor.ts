import type { Answer, AnswerRef, Answerer } from "./assistant.ts";
import { LIMITS, contextLine, type AdvisorContext } from "./advisor-spec.ts";
import { idsIn, placeRef, runTool, type ToolResult } from "./advisor-tools.ts";
import { forecastSource } from "./planahead.ts";
import { SIGNAGE_NOTE } from "./permits.ts";

/**
 * The parking advisor: a tool-using agent that runs its loop in the BROWSER against deterministic tools (advisor-tools.ts), while a
 * Supabase function relays each model turn (holding the Gemini key). The model picks tools and writes the advice; it is never a source
 * of facts. Three guards keep it honest:
 *   1. every number in the answer must appear in a tool result, the driver's own message, or the context line (`checkNumbers`);
 *   2. the PLACES line may only name places a tool actually returned;
 *   3. any failure (network, timeout, quota, malformed turn, guard) returns `ok: false`, and the caller uses the rule-based assistant.
 * Content parts are stored and re-sent verbatim, which also preserves any model "thought signature" a newer Gemini requires.
 */

export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: unknown };
  functionResponse?: { name: string; response: unknown };
}
export interface Content {
  role: "user" | "model";
  parts: Part[];
}
export type Transport = (req: { contents: Content[]; context: AdvisorContext }, signal: AbortSignal) => Promise<Content>;

export type FailReason = "input" | "transport" | "timeout" | "rounds" | "empty" | "guard";
export type AdvisorResult =
  | { ok: true; lines: string[]; refs: AnswerRef[]; tools: { name: string; ok: boolean }[] }
  | { ok: false; reason: FailReason; detail?: string };
export type AdvisorAnswer = Answer & { source?: "ai" | "basic"; reason?: FailReason };

export interface AdvisorOptions {
  transport: Transport;
  getContext: () => AdvisorContext;
  timeoutMs?: number;
  maxRounds?: number;
}

export const ADVISOR_SUGGESTIONS = [
  "I have a 2pm class in Torgersen on Wednesday. Where should I park?",
  "When should I arrive at Hancock Hall for a 10am class to still find a spot?",
  "Can I park at the Squires lot with my permit?",
];

const numbersIn = (s: string): number[] => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Numbers in `text` that are not in `allowed` (list-marker digits like "1." at a line start are ignored). */
export function checkNumbers(text: string, allowed: Set<number>): number[] {
  const cleaned = text.replace(/^\s*\d+[.)]\s+/gm, "");
  return [...new Set(numbersIn(cleaned).filter((n) => !allowed.has(n)))];
}

/** Models sometimes print internal ids in the prose, e.g. "Squires lot (lot-squires)". Remove them; ids belong only on the PLACES line. */
export function stripIds(text: string, ids: Iterable<string>): string {
  let out = text;
  for (const id of [...ids].sort((a, b) => b.length - a.length)) {
    // "(id)", "[id]" and "`id`" (with the space before them) disappear; a bare id becomes the place's name
    for (const [l, r] of [["(", ")"], ["[", "]"], ["`", "`"]] as const) out = out.split(` ${l}${id}${r}`).join("").split(`${l}${id}${r}`).join("");
    if (out.includes(id)) out = out.split(id).join(placeRef(id)?.name ?? "");
  }
  return out;
}

const PLACES_LINE = /^\s*PLACES:\s*(.*)$/im;

export function splitPlaces(text: string): { body: string; ids: string[] } {
  const m = PLACES_LINE.exec(text);
  if (!m) return { body: text.trim(), ids: [] };
  const ids = m[1]!.split(/[,\s]+/).map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== "none");
  return { body: text.replace(PLACES_LINE, "").trim(), ids };
}

const textOf = (c: Content) => c.parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text as string).join("").trim();

export function createAdvisor(opts: AdvisorOptions) {
  const timeoutMs = opts.timeoutMs ?? 25_000; // hosted free models can be slow; each answer is 2-4 sequential model calls
  const maxRounds = Math.min(opts.maxRounds ?? LIMITS.maxRounds, 6);
  let history: Content[] = [];

  async function ask(question: string): Promise<AdvisorResult> {
    const q = question.trim();
    if (!q || q.length > LIMITS.questionChars) return { ok: false, reason: "input" };
    const ctx = opts.getContext();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const contents: Content[] = [...history, { role: "user", parts: [{ text: q }] }];
    const toolLog: { name: string; ok: boolean }[] = [];
    const results: ToolResult[] = [];
    try {
      let final: string | null = null;
      for (let round = 0; round < maxRounds && final === null; round++) {
        const model = await opts.transport({ contents, context: ctx }, ac.signal);
        if (!model || model.role !== "model" || !Array.isArray(model.parts)) return { ok: false, reason: "transport", detail: "bad model turn" };
        contents.push(model);
        const calls = model.parts.filter((p) => p.functionCall);
        if (!calls.length) {
          final = textOf(model);
          break;
        }
        const responses: Part[] = [];
        for (const p of calls.slice(0, 4)) {
          const { name, args } = p.functionCall!;
          const r = runTool(name, args, ctx);
          toolLog.push({ name, ok: r.ok });
          results.push(r);
          const size = JSON.stringify(r).length;
          responses.push({ functionResponse: { name, response: { result: size > LIMITS.toolResponseChars ? { ok: false, error: "result_too_large" } : r } } });
        }
        contents.push({ role: "user", parts: responses });
      }
      if (final === null) return { ok: false, reason: "rounds" };
      if (!final) return { ok: false, reason: "empty" };

      const split = splitPlaces(final);
      const body = stripIds(split.body, idsIn(results)).replace(/[ \t]+([.,;:!?])/g, "$1").trim();
      const ids = split.ids;
      if (!body) return { ok: false, reason: "empty" };

      // Guard 1: no number the tools/driver/context did not supply.
      const allowed = new Set<number>([...numbersIn(JSON.stringify(results)), ...numbersIn(q), ...numbersIn(contextLine(ctx)), ...history.flatMap((h) => numbersIn(textOf(h)))]);
      const bad = checkNumbers(body, allowed);
      if (bad.length) return { ok: false, reason: "guard", detail: `unsupported numbers: ${bad.join(", ")} in: ${body.replace(/\s+/g, " ").slice(0, 200)}` };

      // Guard 2: PLACES may only name places a tool returned.
      const seen = idsIn(results);
      const refs: AnswerRef[] = ids
        .filter((id) => seen.has(id))
        .map((id) => placeRef(id))
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .slice(0, 3)
        .map((p) => ({ kind: p.kind, id: p.id, label: p.name }));

      const used = new Set(toolLog.filter((t) => t.ok).map((t) => t.name));
      const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      if (used.has("plan_parking") || used.has("arrival_advice")) lines.push(`Forecasts come from a Databricks-trained model (${forecastSource().model}) on SIMULATED demand shaped by VT's class timetable, not measured occupancy.`);
      if (used.has("parking_now") || used.has("garages_now") || used.has("accessible_parking")) lines.push("Current counts are the map's demo data, not live sensors.");
      lines.push(SIGNAGE_NOTE);

      const turn: Content[] = [{ role: "user", parts: [{ text: q }] }, { role: "model", parts: [{ text: body }] }];
      history = [...history, ...turn].slice(-6);
      return { ok: true, lines, refs, tools: toolLog };
    } catch (err) {
      if (ac.signal.aborted) return { ok: false, reason: "timeout" };
      return { ok: false, reason: "transport", detail: (err as Error).message?.slice(0, 120) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ask, reset: () => void (history = []) };
}

/** Advisor first; on ANY failure the rule-based answerer responds (tagged "basic"), so the chat never breaks. */
export function withAdvisor(fallback: Answerer, advisor: { ask(q: string): Promise<AdvisorResult> }): Answerer {
  return async (question) => {
    const r = await advisor.ask(question);
    if (r.ok) return { lines: r.lines, refs: r.refs, source: "ai" } satisfies AdvisorAnswer;
    const a = await fallback(question);
    return { ...a, source: "basic", reason: r.reason } satisfies AdvisorAnswer;
  };
}

/** Browser transport: POST the turn to the Supabase function and return the model's next content. */
export function httpTransport(cfg: { url: string; anonKey: string }, fetchFn: typeof fetch = fetch): Transport {
  return async (req, signal) => {
    const res = await fetchFn(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: cfg.anonKey, authorization: `Bearer ${cfg.anonKey}` },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) {
      // the relay's error bodies are safe by construction (no key, no upstream body): include the reason so failures are diagnosable
      let why = "";
      try {
        const j = (await res.json()) as { error?: unknown; upstream_status?: unknown; upstream_code?: unknown; upstream_message?: unknown };
        why = [j.error, j.upstream_status, j.upstream_code, j.upstream_message].filter((x) => typeof x === "string" || typeof x === "number").join(" ");
      } catch {
        /* no JSON body */
      }
      throw new Error(`advisor HTTP ${res.status}${why ? `: ${why}` : ""}`);
    }
    const body = (await res.json()) as { content?: Content };
    if (!body.content) throw new Error("advisor: no content");
    return body.content;
  };
}
