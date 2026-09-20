import { LIMITS, TOOL_DECLARATIONS, TOOL_NAMES, systemPrompt, type AdvisorContext } from "../../../src/lib/advisor-spec.ts";

/**
 * Model providers behind the advisor relay. The app always speaks one format (Gemini-style `contents` of role/parts, with
 * functionCall / functionResponse parts). Each provider translates that to its own API and translates the reply back, so
 * switching providers never touches the client, the tools, or the guards:
 *   - OpenRouter (OpenAI-compatible chat completions, many hosted models incl. free ones) when OPENROUTER_API_KEY is set;
 *   - Gemini generateContent when only GEMINI_API_KEY is set.
 */

export interface Content {
  role: "user" | "model";
  parts: Record<string, unknown>[];
}
export interface ProviderInput {
  contents: Content[];
  context: AdvisorContext;
}
export type Upstream = { ok: true; parts: Record<string, unknown>[]; model?: string } | { ok: false; status: number; error: string; detail?: Record<string, unknown> };
export interface ProviderDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}
export interface ProviderEnv {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  /** One model id, or up to 3 separated by commas (OpenRouter tries them in order). */
  OPENROUTER_MODEL?: string;
  /** Sent as HTTP-Referer for OpenRouter's app attribution. */
  OPENROUTER_REFERER?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isTool = (n: unknown): n is string => typeof n === "string" && (TOOL_NAMES as readonly string[]).includes(n);

/** Keep only the parts the client needs to replay a turn; drop anything unexpected from an upstream response. */
export function sanitizeModelParts(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const p of raw.slice(0, LIMITS.partsPerMessage)) {
    if (!isObj(p)) continue;
    const part: Record<string, unknown> = {};
    if (typeof p.text === "string") part.text = p.text.slice(0, LIMITS.textChars * 2);
    if (p.thought === true) part.thought = true;
    if (typeof p.thoughtSignature === "string" && p.thoughtSignature.length <= LIMITS.signatureChars) part.thoughtSignature = p.thoughtSignature;
    if (isObj(p.functionCall) && isTool(p.functionCall.name)) part.functionCall = { name: p.functionCall.name, args: isObj(p.functionCall.args) ? p.functionCall.args : {} };
    if (Object.keys(part).length) out.push(part);
  }
  return out;
}

/** Gemini's `{error:{status,message}}` and OpenRouter's `{error:{code,message,metadata}}` -> safe, key-redacted, length-capped detail. */
export async function upstreamDetail(res: Response, key: string): Promise<{ upstream_status: number; upstream_code?: string; upstream_message?: string }> {
  const out: { upstream_status: number; upstream_code?: string; upstream_message?: string } = { upstream_status: res.status };
  try {
    return detailFromBody(await res.json(), key, res.status);
  } catch {
    /* non-JSON upstream body: the status alone will do */
  }
  return out;
}
export function detailFromBody(j: unknown, key: string, status: number): { upstream_status: number; upstream_code?: string; upstream_message?: string } {
  const out: { upstream_status: number; upstream_code?: string; upstream_message?: string } = { upstream_status: status };
  const e = isObj(j) && isObj(j.error) ? j.error : null;
  if (!e) return out;
  if (typeof e.status === "string") out.upstream_code = e.status.slice(0, 40);
  else if (typeof e.code === "string" || typeof e.code === "number") out.upstream_code = String(e.code).slice(0, 40);
  if (typeof e.message === "string") out.upstream_message = e.message.split(key).join("[redacted]").slice(0, 200);
  return out;
}

const parseModels = (raw: string | undefined, fallback: string): string[] => {
  const m = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  return m.length ? m : [fallback];
};

// =====================================================================================================================
// Gemini
// =====================================================================================================================
const GEMINI_DEFAULT = "gemini-2.5-flash";

export async function callGemini(input: ProviderInput, env: ProviderEnv, deps: ProviderDeps): Promise<Upstream> {
  const key = env.GEMINI_API_KEY!;
  const models = parseModels(env.GEMINI_MODEL, GEMINI_DEFAULT);
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt(input.context) }] },
    contents: input.contents,
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
  });
  // Overload (503), quota (429), server errors and a retired name (404) move on to the next model; a lone model gets one short
  // retry on overload. Anything else (bad key, bad request) is final.
  const RETRYABLE = new Set([404, 429, 500, 503]);
  let res: Response | null = null;
  let used = models[0]!;
  for (let i = 0; i < models.length; i++) {
    used = models[i]!;
    for (let attempt = 0; attempt < (models.length === 1 ? 2 : 1); attempt++) {
      try {
        res = await deps.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(used)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: payload,
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        res = null;
        if (i === models.length - 1) return { ok: false, status: 504, error: "upstream_timeout" };
        break;
      }
      if (res.status === 503 && attempt === 0 && models.length === 1) {
        await deps.sleep(700);
        continue;
      }
      break;
    }
    if (res && (res.ok || !RETRYABLE.has(res.status))) break;
  }
  if (!res) return { ok: false, status: 504, error: "upstream_timeout" };
  if (!res.ok) {
    const detail = await upstreamDetail(res, key);
    return { ok: false, status: res.status === 429 ? 503 : 502, error: res.status === 429 ? "quota" : "upstream_rejected", detail: { upstream_model: used, ...detail } };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: 502, error: "upstream_bad_json" };
  }
  const cand = isObj(data) && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = sanitizeModelParts(isObj(cand) && isObj(cand.content) ? cand.content.parts : null);
  return parts.length ? { ok: true, parts, model: used } : { ok: false, status: 502, error: "no_content" };
}

// =====================================================================================================================
// OpenRouter (OpenAI-compatible)
// =====================================================================================================================
/** `openrouter/free` routes to a currently available free model that supports tool calling; set OPENROUTER_MODEL to pin specific ones. */
export const OPENROUTER_DEFAULT = "openrouter/free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type OaMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Gemini-style turns -> OpenAI chat messages. Tool-call ids are derived from the position of the model turn, so every request re-derives the same ids. */
export function toOpenAiMessages(contents: Content[], context: AdvisorContext): OaMessage[] {
  const messages: OaMessage[] = [{ role: "system", content: systemPrompt(context) }];
  let pending: { id: string; name: string }[] = [];
  contents.forEach((c, ci) => {
    const text = c.parts.filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text as string).join("");
    if (c.role === "model") {
      const calls = c.parts.filter((p) => isObj(p.functionCall)).map((p, j) => {
        const fc = p.functionCall as { name: string; args?: unknown };
        return { id: `call_${ci}_${j}`, type: "function" as const, function: { name: fc.name, arguments: JSON.stringify(isObj(fc.args) ? fc.args : {}) } };
      });
      pending = calls.map((k) => ({ id: k.id, name: k.function.name }));
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      return;
    }
    for (const p of c.parts) {
      if (!isObj(p.functionResponse)) continue;
      const fr = p.functionResponse as { name: string; response: unknown };
      const at = pending.findIndex((k) => k.name === fr.name);
      const id = (at >= 0 ? pending.splice(at, 1)[0]! : { id: `call_${ci}_x` }).id;
      messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(fr.response).slice(0, LIMITS.toolResponseChars) });
    }
    if (text) messages.push({ role: "user", content: text });
  });
  return messages;
}

export const toOpenAiTools = () => TOOL_DECLARATIONS.map((d) => ({ type: "function" as const, function: { name: d.name, description: d.description, parameters: d.parameters } }));

/** OpenAI assistant message -> Gemini-style parts (text + functionCall). Unparseable tool arguments become {} so the tool reports a clear error. */
export function fromOpenAiMessage(msg: unknown): Record<string, unknown>[] {
  if (!isObj(msg)) return [];
  const parts: Record<string, unknown>[] = [];
  if (typeof msg.content === "string" && msg.content.trim()) parts.push({ text: msg.content });
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls.slice(0, LIMITS.partsPerMessage)) {
      const fn = isObj(tc) && isObj(tc.function) ? tc.function : null;
      if (!fn || !isTool(fn.name)) continue;
      let args: unknown = {};
      if (typeof fn.arguments === "string") {
        try {
          args = JSON.parse(fn.arguments);
        } catch {
          args = {};
        }
      } else if (isObj(fn.arguments)) args = fn.arguments;
      parts.push({ functionCall: { name: fn.name, args: isObj(args) ? args : {} } });
    }
  }
  return sanitizeModelParts(parts);
}

export async function callOpenRouter(input: ProviderInput, env: ProviderEnv, deps: ProviderDeps): Promise<Upstream> {
  const key = env.OPENROUTER_API_KEY!;
  const models = parseModels(env.OPENROUTER_MODEL, OPENROUTER_DEFAULT);
  const payload = JSON.stringify({
    // several ids use OpenRouter's own fallback routing (one request, tried in order); one id is the plain form
    ...(models.length > 1 ? { models } : { model: models[0] }),
    messages: toOpenAiMessages(input.contents, input.context),
    tools: toOpenAiTools(),
    tool_choice: "auto",
    temperature: 0.3,
    max_tokens: 800,
  });
  const headers = {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    "http-referer": env.OPENROUTER_REFERER?.trim() || "https://heuyz14.github.io/terraceb/",
    "x-title": "HokiePark",
  };
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await deps.fetch(OPENROUTER_URL, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(20_000) });
    } catch {
      return { ok: false, status: 504, error: "upstream_timeout" };
    }
    if ((res.status === 502 || res.status === 503) && attempt === 0) {
      await deps.sleep(700);
      continue;
    }
    break;
  }
  if (!res) return { ok: false, status: 504, error: "upstream_timeout" };
  if (!res.ok) {
    const detail = await upstreamDetail(res, key);
    const hint = res.status === 402 ? { hint: "OpenRouter says the account has insufficient credits for this request." } : res.status === 404 ? { hint: "No provider matched: check OPENROUTER_MODEL and OpenRouter's privacy settings for free models." } : {};
    return { ok: false, status: res.status === 429 ? 503 : 502, error: res.status === 429 ? "quota" : "upstream_rejected", detail: { upstream_model: models.join(","), ...detail, ...hint } };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: 502, error: "upstream_bad_json" };
  }
  // OpenRouter can return HTTP 200 with an error body (a provider failed mid-request)
  if (isObj(data) && isObj(data.error)) return { ok: false, status: 502, error: "upstream_rejected", detail: { upstream_model: models.join(","), ...detailFromBody(data, key, 200) } };
  const choice = isObj(data) && Array.isArray(data.choices) ? data.choices[0] : null;
  if (isObj(choice) && isObj(choice.error)) return { ok: false, status: 502, error: "upstream_rejected", detail: { upstream_model: models.join(","), ...detailFromBody({ error: choice.error }, key, 200) } };
  const parts = fromOpenAiMessage(isObj(choice) ? choice.message : null);
  const model = isObj(data) && typeof data.model === "string" ? data.model.slice(0, 80) : models[0];
  return parts.length ? { ok: true, parts, ...(model ? { model } : {}) } : { ok: false, status: 502, error: "no_content", detail: { upstream_model: model ?? "" } };
}
