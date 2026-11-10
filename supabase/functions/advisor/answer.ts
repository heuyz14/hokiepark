import { GARAGES } from "../../../src/data/index.ts";
import { createAdvisor, type Content, type AdvisorAnswer } from "../../../src/lib/advisor.ts";
import { createToolRunner } from "../../../src/lib/advisor-tools.ts";
import { applyOccupancy, fetchOccupancy, latestUpdate } from "../../../src/lib/occupancy-remote.ts";
import { detectPermits, findPlace } from "../../../src/lib/assistant.ts";
import { parseDay, parseTime } from "../../../src/lib/planask.ts";
import { LIMITS, PERMIT_IDS, type AdvisorContext } from "../../../src/lib/advisor-spec.ts";
import { callGemini, callOpenRouter, type ProviderEnv } from "./providers.ts";

export interface AnswerEnv extends ProviderEnv { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string }
export interface ChatInput { question: string; history: Content[]; permits: AdvisorContext["permits"]; ada: boolean; currentLocation?: AdvisorContext["currentLocation"] }
export interface Provenance { execution: "server"; source: "supabase_simulation" | "bundled_simulation"; simulated: true; dataAsOf: string | null; fetchedAt: string; requestId: string }
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Only user text/preferences cross this boundary. Client-supplied tool results are rejected. */
export function parseChatInput(body: unknown): ChatInput | null {
  if (!obj(body) || typeof body.question !== "string" || !body.question.trim() || body.question.length > LIMITS.questionChars) return null;
  if (body.contents !== undefined || body.functionResponse !== undefined || body.occupancy !== undefined || body.tools !== undefined) return null;
  const context = obj(body.context) ? body.context : {};
  const permits = context.permits ?? [];
  if (!Array.isArray(permits) || permits.length > PERMIT_IDS.length || !permits.every((p) => PERMIT_IDS.includes(p as never))) return null;
  if (context.ada !== undefined && typeof context.ada !== "boolean") return null;
  const location = context.currentLocation;
  if (location !== undefined && (!obj(location) || typeof location.lat !== "number" || !Number.isFinite(location.lat) || Math.abs(location.lat)>90 || typeof location.lon !== "number" || !Number.isFinite(location.lon) || Math.abs(location.lon)>180 || (location.accuracyMeters !== undefined && (typeof location.accuracyMeters !== "number" || !Number.isFinite(location.accuracyMeters) || location.accuracyMeters<0)))) return null;
  const raw = body.history ?? [];
  if (!Array.isArray(raw) || raw.length > 6) return null;
  const history: Content[] = [];
  for (const turn of raw) {
    if (!obj(turn) || !["user", "model"].includes(String(turn.role)) || typeof turn.text !== "string" || !turn.text.trim() || turn.text.length > LIMITS.textChars || Object.keys(turn).some((key) => key !== "role" && key !== "text")) return null;
    history.push({ role: turn.role as "user" | "model", parts: [{ text: turn.text }] });
  }
  return { question: body.question.trim(), history, permits: permits as ChatInput["permits"], ada: context.ada === true, ...(location ? {currentLocation:location as unknown as AdvisorContext["currentLocation"]} : {}) };
}

function campusNow(now: number): AdvisorContext["now"] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { dow: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export async function answerParking(input: ChatInput, env: AnswerEnv, deps: { fetch: typeof fetch; now: () => number; sleep?: (ms: number) => Promise<void> }) {
  const now = deps.now();
  // Never mutate the shared browser/reference arrays in a warm Edge Function.
  const garages = structuredClone(GARAGES);
  const provenance: Provenance = { execution: "server", source: "bundled_simulation", simulated: true, dataAsOf: null, fetchedAt: new Date(now).toISOString(), requestId: crypto.randomUUID() };
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    try {
      const rows = await fetchOccupancy({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, pollMs: 60_000 }, deps.fetch);
      applyOccupancy(garages, rows);
      provenance.source = "supabase_simulation";
      provenance.dataAsOf = new Date(latestUpdate(rows)).toISOString();
    } catch { /* Explicitly labelled reference snapshot, never presented as a fresh DB read. */ }
  }
  const tools = createToolRunner({ garages });
  const previousUsers = input.history.filter((h) => h.role === "user").map((h) => h.parts.map((p) => p.text ?? "").join(" "));
  const named = detectPermits(input.question.toLowerCase());
  const remembered = [...previousUsers].reverse().map((q) => detectPermits(q.toLowerCase())).find((p) => p.length);
  const context: AdvisorContext = { now: campusNow(now), permits: named.length ? named : input.permits.length ? input.permits : remembered ?? [], ada: input.ada, ...(input.currentLocation ? {currentLocation:input.currentLocation} : {}) };
  // This explicit fact lookup has a deterministic origin; do not let conversation history replace it with a building.
  const nearbyLocation = /\b(park|parking|spaces?|spots?|lots?|garages?)\b/i.test(input.question) && /\b(near me|around me|near my (?:current )?(?:location|position))\b/i.test(input.question);
  const call = env.OPENROUTER_API_KEY ? callOpenRouter : env.GEMINI_API_KEY ? callGemini : null;
  if (call && !nearbyLocation) {
    const advisor = createAdvisor({ tools, history: input.history, getContext: () => context, transport: async (request, signal) => {
      const fetchWithSignal: typeof fetch = (url, init) => deps.fetch(url, { ...init, signal });
      const providerInput = { ...request, contents: request.contents.map((turn) => ({ ...turn, parts: turn.parts.map((part) => ({ ...part })) })) };
      const reply = await call(providerInput, env, { fetch: fetchWithSignal, sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))) });
      if (!reply.ok) throw new Error("provider_unavailable");
      return { role: "model", parts: reply.parts } as Content;
    } });
    const result = await advisor.ask(input.question);
    if (result.ok) {
      const answer: AdvisorAnswer = { ...result, source: "ai", lines: [...result.lines, sourceLine(provenance)] };
      return { answer, provenance };
    }
  }
  // A small backend-owned fallback supports the interview's core parking questions even without a model key.
  const latestPlace = findPlace(input.question);
  const place = latestPlace ?? [...previousUsers].reverse().map(findPlace).find(Boolean);
  const latestTime = parseTime(input.question);
  const time = /\b(now|right now|currently)\b/i.test(input.question) ? null : latestTime ?? [...previousUsers].reverse().map(parseTime).find((t) => t !== null) ?? null;
  const day = parseDay(input.question, context.now.dow) ?? [...previousUsers].reverse().map((q) => parseDay(q, context.now.dow)).find((d) => d !== null) ?? context.now.dow;
  const name = nearbyLocation ? "parking_now" : place && place.kind !== "building" && /tell me|details|about/i.test(input.question) ? "get_lot_details" : place && place.kind !== "building" && /can i park|permit|allowed/i.test(input.question) ? "permit_check" : place?.kind === "building" && time !== null && /when.*arriv|what time.*arriv/i.test(input.question) ? "arrival_advice" : /accessible|\bada\b/i.test(input.question) ? "accessible_parking" : /\b(which garage|garages|most (?:open|spaces))\b/i.test(input.question) ? "garages_now" : place?.kind === "building" && time !== null ? "plan_parking" : place ? "parking_now" : "garages_now";
  const result = tools.runTool(name, { place_id: nearbyLocation ? "current_location" : place?.id, lot_id: place?.id, building_id: place?.id, day_of_week: day, class_time: time === null ? undefined : `${String(Math.floor(time / 60)).padStart(2,"0")}:${String(time % 60).padStart(2,"0")}` }, context);
  const refs: AdvisorAnswer["refs"] = [];
  const lines: string[] = [];
  if (!result.ok) lines.push(result.error === "location_unavailable" ? "Use the map’s location button or allow browser location access, then ask for parking near me again." : result.error === "no_permit" ? "Which parking permit do you hold?" : "Please name a campus destination, your permit, and a class time for a parking plan.");
  else {
    const data = result as Record<string, unknown>;
    if (name === "get_lot_details") {
      lines.push(`${String(data.name)}: ${String(data.capacity)} total spaces in the reference dataset.`, `Signed permit classes: ${(data.permit_classes as string[]).join(", ") || "unknown; check signage"}.`, `Accessible spaces listed: ${data.has_accessible_spaces ? "yes" : "not listed"}.`);
      const ref = tools.placeRef(String(data.id));
      if (ref) refs.push({kind:ref.kind,id:ref.id,label:ref.name});
    } else if (name === "permit_check") {
      lines.push(`${String(data.place)} — permit result: ${data.verdict === "yes" ? "eligible under the encoded rules" : data.verdict === "no" ? "not eligible under the encoded rules" : "unconfirmed; check posted signage"}.`);
      if(data.note) lines.push(String(data.note));
    } else if (name === "arrival_advice") {
      lines.push(`Arrival options for ${String(data.building)} (${String(data.class_time)} class):`);
      for (const option of (data.options as Record<string,unknown>[]).slice(0,2)) {
        const arrival = option.latest_arrival_not_risky as {arrive_time:string}|null;
        lines.push(`${String(option.name)}: ${arrival ? `forecast suggests arriving at the parking facility by ${arrival.arrive_time}` : "no lower-risk arrival was found in the tested time windows"}; about ${String(option.walk_minutes)} min walk. Allow ${String(option.parking_search_minutes)} min to park and a ${String(option.buffer_minutes)} min class buffer. This is a simulated forecast, not a guarantee.`);
        const ref=tools.placeRef(String(option.id));if(ref)refs.push({kind:ref.kind,id:ref.id,label:ref.name});
      }
      if(!(data.options as unknown[]).length) lines.push("No permit-confirmed arrival option was found.");
    } else {
      const rows = (data.recommended ?? data.nearest_with_open_spaces ?? data.ranked_most_open_first ?? data.lots ?? []) as Record<string,unknown>[];
      lines.push(name === "plan_parking" ? `Parking options for ${String(data.building)}:` : nearbyLocation ? "Parking near your current location:" : "Parking information from the backend dataset:");
      for (const row of rows.slice(0,3)) {
        const ref = tools.placeRef(String(row.id));
        if (ref) refs.push({kind:ref.kind,id:ref.id,label:ref.name});
        lines.push(`- ${String(row.name)}: ${String(row.forecast_open_spaces ?? row.open_spaces_on_levels_your_permit_covers ?? row.current_open_spaces ?? row.designated_accessible_spaces ?? "unknown")} ${name === "accessible_parking" ? "designated accessible spaces (illustrative)" : name === "plan_parking" ? "forecast open spaces" : "simulated open spaces"}${row.walk_minutes !== undefined ? `, about ${row.walk_minutes} min walk${nearbyLocation ? " (straight-line estimate)" : ""}` : ""}.`);
      }
      if (!rows.length) lines.push("No confirmed matching option was returned; check posted signage.");
    }
    if (data.permit_checked === false) lines.push("Your permit has not been checked. Set your permit before choosing a space.");
  }
  if (name === "plan_parking" || name === "arrival_advice") lines.push("Forecast source: bundled model output trained on simulated parking labels; forecast counts are not current database occupancy.");
  if (name === "garages_now" && context.permits.length) lines.push("Counts include only levels covered by your selected permit; zero is not a claim that the entire garage is full.");
  lines.push(sourceLine(provenance), "Always follow posted parking signage.");
  return { answer: { lines, refs, source: "basic", tools: [{name,ok:result.ok}] } satisfies AdvisorAnswer, provenance };
}
function sourceLine(p: Provenance) {
  if (p.source !== "supabase_simulation") return "Source: bundled simulation; database unavailable, not live sensor counts.";
  const updated = p.dataAsOf ? new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(p.dataAsOf)) : "unknown";
  return `Source: Supabase simulation · updated ${updated}.`;
}
