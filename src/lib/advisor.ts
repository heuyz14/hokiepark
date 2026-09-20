import { detectPermits, type Answer, type AnswerRef, type Answerer } from "./assistant.ts";
import { LIMITS, contextLine, type AdvisorContext } from "./advisor-spec.ts";
import { idsIn, placeRef, runTool, type ToolResult } from "./advisor-tools.ts";
import { forecastSource } from "./planahead.ts";
import { SIGNAGE_NOTE, type PermitId } from "./permits.ts";

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

export type FailReason = "input" | "transport" | "timeout" | "rounds" | "tool_limit" | "empty" | "guard";
export type AdvisorToolEvent = { id: string; name: string; label: string; status: "running" | "success" | "error" };
export type AdvisorMapAction =
  | { type: "focus_lot" | "focus_destination"; id: string }
  | { type: "show_route"; geometry: { latitude: number; longitude: number }[]; routeType: "walk_graph" | "straight_line_estimate" };
export type AdvisorResult =
  | { ok: true; lines: string[]; refs: AnswerRef[]; tools: { name: string; ok: boolean }[]; mapActions?: AdvisorMapAction[] }
  | { ok: false; reason: FailReason; detail?: string };
export type AdvisorAnswer = Answer & { source?: "ai" | "basic"; reason?: FailReason; tools?: { name: string; ok: boolean }[]; mapActions?: AdvisorMapAction[] };

export const ADVISOR_TOOL_LABELS: Record<string, string> = {
  find_place: "Found destination",
  resolve_destination: "Resolved destination",
  get_lot_details: "Looked up parking details",
  get_eligible_lots: "Checked eligible lots",
  get_parking_forecast: "Forecast parking availability",
  get_ticket_risk: "Checked parking restrictions",
  get_current_location: "Checked current location",
  plan_parking: "Checked eligible parking",
  parking_now: "Checked current parking",
  arrival_advice: "Built arrival timing advice",
  permit_check: "Checked parking restrictions",
  garages_now: "Compared garage availability",
  accessible_parking: "Checked accessible parking",
  calculate_walk_route: "Calculated walking estimate",
  compare_parking_options: "Compared parking options",
  build_arrival_plan: "Built arrival plan",
};

export interface AdvisorOptions {
  transport: Transport;
  getContext: () => AdvisorContext;
  timeoutMs?: number;
  maxRounds?: number;
  onToolEvent?: (event: AdvisorToolEvent) => void;
}

const mapActionsFrom = (results: ToolResult[]): AdvisorMapAction[] => {
  const actions: AdvisorMapAction[] = [];
  for (const result of results) {
    if (!result.ok) continue;
    const route = result as Record<string, unknown>;
    const geometry = route.geometry;
    if (route.route_type && Array.isArray(geometry) && (route.route_type === "walk_graph" || route.route_type === "straight_line_estimate")) {
      const points = geometry.filter((point): point is { latitude: number; longitude: number } => Boolean(point) && typeof point === "object" && Number.isFinite((point as { latitude?: unknown }).latitude) && Number.isFinite((point as { longitude?: unknown }).longitude));
      if (points.length >= 2) actions.push({ type: "show_route", geometry: points.slice(0, 100), routeType: route.route_type });
    }
  }
  return actions;
};

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
  /** Permits the driver named in this chat ("commuter"), remembered for later questions when none is saved. */
  let sessionPermits: PermitId[] = [];

  async function ask(question: string): Promise<AdvisorResult> {
    const q = question.trim();
    if (!q || q.length > LIMITS.questionChars) return { ok: false, reason: "input" };
    const base = opts.getContext();
    // A permit named in the message wins (like the rule-based assistant), then the saved one, then one named earlier in this chat.
    const named = detectPermits(q.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim());
    if (named.length) sessionPermits = named;
    const ctx: AdvisorContext = { ...base, permits: named.length ? named : base.permits.length ? base.permits : sessionPermits };
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
          if (toolLog.length >= LIMITS.maxToolCalls) return { ok: false, reason: "tool_limit" };
          const { name, args } = p.functionCall!;
          const event = { id: `${round}-${toolLog.length}`, name, label: ADVISOR_TOOL_LABELS[name] ?? "Running HokiePark tool" } as const;
          opts.onToolEvent?.({ ...event, status: "running" });
          const r = runTool(name, args, ctx);
          toolLog.push({ name, ok: r.ok });
          opts.onToolEvent?.({ ...event, status: r.ok ? "success" : "error" });
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
      return { ok: true, lines, refs, tools: toolLog, mapActions: mapActionsFrom(results) };
    } catch (err) {
      if (ac.signal.aborted) return { ok: false, reason: "timeout" };
      return { ok: false, reason: "transport", detail: (err as Error).message?.slice(0, 120) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Record an exchange answered by ANOTHER engine (the rule-based fallback) so a follow-up like "commuter" still has its context. */
  function remember(question: string, answer: string) {
    const q = question.trim().slice(0, LIMITS.questionChars);
    const a = answer.trim().slice(0, 600);
    if (!q || !a) return;
    const named = detectPermits(q.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim());
    if (named.length) sessionPermits = named;
    history = [...history, { role: "user" as const, parts: [{ text: q }] }, { role: "model" as const, parts: [{ text: a }] }].slice(-6);
  }

  return { ask, remember, reset: () => void ((history = []), (sessionPermits = [])) };
}

/** Advisor first; on ANY failure the rule-based answerer responds (tagged "basic"), so the chat never breaks. */
export function withAdvisor(fallback: Answerer, advisor: { ask(q: string): Promise<AdvisorResult>; remember?(question: string, answer: string): void }): Answerer {
  return async (question) => {
    const r = await advisor.ask(question);
    if (r.ok) return { lines: r.lines, refs: r.refs, tools: r.tools, mapActions: r.mapActions, source: "ai" } satisfies AdvisorAnswer;
    const a = await fallback(question);
    // the fallback's answer is part of the conversation: without this the advisor forgets what "commuter" was answering
    advisor.remember?.(question, a.lines.filter((l) => l !== SIGNAGE_NOTE).join("\n"));
    return { ...a, source: "basic", reason: r.reason } satisfies AdvisorAnswer;
  };
}

/** Browser transport: POST the turn to the Supabase function and return the model's next content. */
export function httpTransport(cfg: { url: string; anonKey: string }, fetchFn: typeof fetch = fetch): Transport {
  return async (req, signal) => {
    // Exact location is trusted application context for local tools only. The relay/model gets
    // the ordinary parking context but never coordinates, even when it requested a route.
    const { currentLocation: _privateLocation, ...publicContext } = req.context;
    const res = await fetchFn(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: cfg.anonKey, authorization: `Bearer ${cfg.anonKey}` },
      body: JSON.stringify({ contents: req.contents, context: publicContext }),
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
