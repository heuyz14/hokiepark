import { LIMITS, PERMIT_IDS, TOOL_DECLARATIONS, TOOL_NAMES, systemPrompt, type AdvisorContext } from "../../../src/lib/advisor-spec.ts";

/**
 * Supabase Edge Function `advisor`: a thin, defensive relay between the HokiePark app and the Gemini API.
 *  - holds GEMINI_API_KEY (a function secret; it never reaches the browser and is never echoed);
 *  - injects the system prompt and the tool DECLARATIONS itself, so a caller cannot change the rules or add tools;
 *  - validates and size-limits everything the browser sends, rate-limits per visitor and per day;
 *  - returns only the model's next turn. Tools run in the browser; the model is never a source of facts.
 * Pure request/response code (Web-standard Request/Response/fetch) so it is unit-tested in Node and runs unchanged on Deno.
 */

export interface Env {
  GEMINI_API_KEY?: string;
  /** Model id, or several separated by commas (tried in order when one is overloaded, over quota, or retired). Check Google AI Studio for current ids. */
  GEMINI_MODEL?: string;
  /** Comma-separated allowed browser origins, e.g. "https://heuyz14.github.io". Unset = any origin (fine for local testing only). */
  ALLOWED_ORIGINS?: string;
  PER_IP_LIMIT?: string;
  DAILY_LIMIT?: string;
}
export interface Limiter {
  /** true = allowed. Sliding window per key. */
  hit(key: string, limit: number, windowMs: number, now: number): boolean;
}
export interface Deps {
  fetch: typeof fetch;
  now: () => number;
  limiter: Limiter;
  /** Pause between retries (injectable so tests do not wait). */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const IP_WINDOW_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export function createLimiter(): Limiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, limit, windowMs, now) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1]! > windowMs) hits.delete(k);
      return true;
    },
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

function corsHeaders(req: Request, env: Env): Record<string, string> | null {
  const origin = req.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && origin && !allowed.includes(origin)) return null;
  return {
    "access-control-allow-origin": allowed.length ? (origin ?? allowed[0]!) : "*",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "origin",
  };
}

// ---------- validation ----------
export interface ValidBody {
  contents: { role: "user" | "model"; parts: Record<string, unknown>[] }[];
  context: AdvisorContext;
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const size = (v: unknown) => JSON.stringify(v).length;

export function validateBody(body: unknown): ValidBody | { error: string } {
  if (!isObj(body)) return { error: "body must be an object" };
  const { contents, context } = body;
  if (!isObj(context) || !isObj(context.now)) return { error: "bad context" };
  const { dow, minute } = context.now;
  if (!Number.isInteger(dow) || (dow as number) < 1 || (dow as number) > 7 || !Number.isInteger(minute) || (minute as number) < 0 || (minute as number) > 1439) return { error: "bad context.now" };
  if (!Array.isArray(context.permits) || context.permits.length > PERMIT_IDS.length || !context.permits.every((p) => typeof p === "string" && (PERMIT_IDS as string[]).includes(p))) return { error: "bad context.permits" };
  if (typeof context.ada !== "boolean") return { error: "bad context.ada" };
  if (!Array.isArray(contents) || contents.length < 1 || contents.length > LIMITS.historyMessages) return { error: "bad contents length" };

  const clean: ValidBody["contents"] = [];
  for (const c of contents) {
    if (!isObj(c) || (c.role !== "user" && c.role !== "model") || !Array.isArray(c.parts) || c.parts.length < 1 || c.parts.length > LIMITS.partsPerMessage) return { error: "bad message" };
    const parts: Record<string, unknown>[] = [];
    for (const p of c.parts) {
      if (!isObj(p)) return { error: "bad part" };
      const out: Record<string, unknown> = {};
      if (p.text !== undefined) {
        if (typeof p.text !== "string" || p.text.length > LIMITS.textChars) return { error: "bad text" };
        if (c.role === "user" && p.text.length > LIMITS.questionChars) return { error: "question too long" };
        out.text = p.text;
      }
      if (p.thought !== undefined) {
        if (typeof p.thought !== "boolean") return { error: "bad thought" };
        out.thought = p.thought;
      }
      if (p.thoughtSignature !== undefined) {
        if (typeof p.thoughtSignature !== "string" || p.thoughtSignature.length > LIMITS.signatureChars) return { error: "bad signature" };
        out.thoughtSignature = p.thoughtSignature;
      }
      if (p.functionCall !== undefined) {
        const fc = p.functionCall;
        if (c.role !== "model" || !isObj(fc) || typeof fc.name !== "string" || !(TOOL_NAMES as readonly string[]).includes(fc.name) || (fc.args !== undefined && !isObj(fc.args)) || size(fc.args ?? {}) > LIMITS.textChars) return { error: "bad functionCall" };
        out.functionCall = { name: fc.name, args: fc.args ?? {} };
      }
      if (p.functionResponse !== undefined) {
        const fr = p.functionResponse;
        if (c.role !== "user" || !isObj(fr) || typeof fr.name !== "string" || !(TOOL_NAMES as readonly string[]).includes(fr.name) || !isObj(fr.response) || size(fr.response) > LIMITS.toolResponseChars) return { error: "bad functionResponse" };
        out.functionResponse = { name: fr.name, response: fr.response };
      }
      if (!Object.keys(out).length) return { error: "empty part" };
      parts.push(out);
    }
    clean.push({ role: c.role, parts });
  }
  if (clean[0]!.role !== "user" || clean.at(-1)!.role !== "user") return { error: "conversation must start and end with a user turn" };
  return { contents: clean, context: { now: { dow: dow as number, minute: minute as number }, permits: context.permits as AdvisorContext["permits"], ada: context.ada } };
}

/** Keep only the parts the client needs to replay the turn; drop anything unexpected from the upstream response. */
export function sanitizeModelParts(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const p of raw.slice(0, LIMITS.partsPerMessage)) {
    if (!isObj(p)) continue;
    const part: Record<string, unknown> = {};
    if (typeof p.text === "string") part.text = p.text.slice(0, LIMITS.textChars * 2);
    if (p.thought === true) part.thought = true;
    if (typeof p.thoughtSignature === "string" && p.thoughtSignature.length <= LIMITS.signatureChars) part.thoughtSignature = p.thoughtSignature;
    if (isObj(p.functionCall) && typeof p.functionCall.name === "string" && (TOOL_NAMES as readonly string[]).includes(p.functionCall.name)) {
      part.functionCall = { name: p.functionCall.name, args: isObj(p.functionCall.args) ? p.functionCall.args : {} };
    }
    if (Object.keys(part).length) out.push(part);
  }
  return out;
}

export async function upstreamDetail(res: Response, key: string): Promise<{ upstream_status: number; upstream_code?: string; upstream_message?: string }> {
  const out: { upstream_status: number; upstream_code?: string; upstream_message?: string } = { upstream_status: res.status };
  try {
    const j = (await res.json()) as { error?: { status?: unknown; message?: unknown } };
    if (typeof j.error?.status === "string") out.upstream_code = j.error.status.slice(0, 40);
    if (typeof j.error?.message === "string") out.upstream_message = j.error.message.split(key).join("[redacted]").slice(0, 200);
  } catch {
    /* non-JSON upstream body: the status alone will do */
  }
  return out;
}

export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req, env);
  if (!cors) return json(403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, cors);
  if (!env.GEMINI_API_KEY) return json(500, { error: "not_configured" }, cors);

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > LIMITS.requestBytes) return json(413, { error: "too_large" }, cors);
  const raw = await req.text();
  if (raw.length > LIMITS.requestBytes) return json(413, { error: "too_large" }, cors);

  const now = deps.now();
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim();
  const perIp = Number(env.PER_IP_LIMIT) || 60;
  const daily = Number(env.DAILY_LIMIT) || 1500;
  if (!deps.limiter.hit(`ip:${ip}`, perIp, IP_WINDOW_MS, now) || !deps.limiter.hit("global", daily, DAY_MS, now)) {
    return json(429, { error: "rate_limited" }, { ...cors, "retry-after": "60" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid_json" }, cors);
  }
  const v = validateBody(parsed);
  if ("error" in v) return json(400, { error: v.error }, cors);

  const models = (env.GEMINI_MODEL ?? "").split(",").map((m) => m.trim()).filter(Boolean).slice(0, 3);
  if (!models.length) models.push(DEFAULT_MODEL);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt(v.context) }] },
    contents: v.contents,
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
  });
  // Try each model in order. Overload (503), quota (429), server errors and a retired name (404) move on to the next model;
  // a lone model gets one short retry on overload. Anything else (bad key, bad request) is final.
  const RETRYABLE = new Set([404, 429, 500, 503]);
  let res: Response | null = null;
  let usedModel = models[0]!;
  for (let i = 0; i < models.length; i++) {
    usedModel = models[i]!;
    for (let attempt = 0; attempt < (models.length === 1 ? 2 : 1); attempt++) {
      try {
        res = await deps.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(usedModel)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: payload,
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        res = null;
        if (i === models.length - 1) return json(504, { error: "upstream_timeout" }, cors);
        break;
      }
      if (res.status === 503 && attempt === 0 && models.length === 1) {
        await sleep(700);
        continue;
      }
      break;
    }
    if (res && (res.ok || !RETRYABLE.has(res.status))) break;
  }
  if (!res) return json(504, { error: "upstream_timeout" }, cors);
  if (!res.ok) {
    // Surface Gemini's own error code and message (key redacted, length-capped) so a bad model name / key / quota is diagnosable
    // from the app or `npm run check:advisor`, without ever echoing the request, the key, or the raw upstream body.
    const detail = await upstreamDetail(res, env.GEMINI_API_KEY);
    return json(res.status === 429 ? 503 : 502, { error: res.status === 429 ? "quota" : "upstream_rejected", upstream_model: usedModel, ...detail }, cors);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return json(502, { error: "upstream_bad_json" }, cors);
  }
  const cand = isObj(data) && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = sanitizeModelParts(isObj(cand) && isObj(cand.content) ? cand.content.parts : null);
  if (!parts.length) return json(502, { error: "no_content" }, cors);
  return json(200, { content: { role: "model", parts } }, cors);
}
