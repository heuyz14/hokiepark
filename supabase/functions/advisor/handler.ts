import { LIMITS, PERMIT_IDS, TOOL_NAMES, type AdvisorContext } from "../../../src/lib/advisor-spec.ts";
import { callGemini, callOpenRouter } from "./providers.ts";

export { sanitizeModelParts, upstreamDetail } from "./providers.ts";

/**
 * Supabase Edge Function `advisor`: a thin, defensive relay between the HokiePark app and the Gemini API.
 *  - holds the model API key as a function secret (OPENROUTER_API_KEY, or GEMINI_API_KEY): it never reaches the browser and is never echoed;
 *  - injects the system prompt and the tool DECLARATIONS itself, so a caller cannot change the rules or add tools;
 *  - validates and size-limits everything the browser sends, rate-limits per visitor and per day;
 *  - returns only the model's next turn. Tools run in the browser; the model is never a source of facts.
 * Pure request/response code (Web-standard Request/Response/fetch) so it is unit-tested in Node and runs unchanged on Deno.
 */

export interface Env {
  /** OpenRouter (OpenAI-compatible; many models incl. free ones). Takes precedence when set. */
  OPENROUTER_API_KEY?: string;
  /** One OpenRouter model id, or up to 3 comma-separated (tried in order). Default: openrouter/free. */
  OPENROUTER_MODEL?: string;
  OPENROUTER_REFERER?: string;
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

export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req, env);
  if (!cors) return json(403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const provider = env.OPENROUTER_API_KEY ? "openrouter" : env.GEMINI_API_KEY ? "gemini" : null;
  if (req.method === "GET") {
    // Health/diagnostics: which provider and model ids this deployment sees. Names only, never a key, and it costs no model request.
    const raw = provider === "openrouter" ? env.OPENROUTER_MODEL : env.GEMINI_MODEL;
    const models = (raw ?? "").split(",").map((m) => m.trim()).filter(Boolean).slice(0, 3);
    return json(200, { service: "hokiepark-advisor", provider, models: models.length ? models : provider === "openrouter" ? ["openrouter/free (default)"] : provider ? ["gemini-2.5-flash (default)"] : [], gemini_key_also_set: Boolean(env.GEMINI_API_KEY && env.OPENROUTER_API_KEY) }, cors);
  }
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, cors);
  if (!provider) return json(500, { error: "not_configured" }, cors);

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

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const call = provider === "openrouter" ? callOpenRouter : callGemini;
  const up = await call({ contents: v.contents, context: v.context }, env, { fetch: deps.fetch, sleep });
  if (!up.ok) return json(up.status, { error: up.error, ...(up.detail ?? {}) }, cors);
  return json(200, { content: { role: "model", parts: up.parts } }, cors);
}
