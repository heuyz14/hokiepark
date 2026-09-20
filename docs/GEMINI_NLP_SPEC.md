# Spec: LLM-assisted request parsing for Ask and Plan-ahead (Gemini)

Status: **proposed, not built.** Optional stretch after the plan-ahead recommender. Written 2026-09-19.

## 1. Goal
Let a driver type what they mean ("I've got a 2 o'clock in torgy tomorrow, commuter permit") and have the app work out the building, weekday, time and permit,
instead of relying on exact-word matching. **The language model only extracts structure. Every number, distance, permit verdict and prediction still comes
from the app's own code and data**, exactly as today.

Non-goals: the model never writes answer facts, never computes distances or availability, never decides permit eligibility, and is never required for the app to work.

## 2. Why not a vector database or embeddings
* The searchable universe is about 200 items (102 buildings, 94 parking places). A compact list of every name with its id is ~3-4k tokens: it fits in the prompt.
* A model that sees the actual list resolves nicknames, typos and abbreviations ("torgy", "hancock") and returns an id we can validate. Embedding nearest-neighbour is weaker on exact identity.
* If the list ever grows to thousands of items, add embeddings **for candidate retrieval only** (embed names offline into a JSON file, cosine-search in the browser, pass the top 20 to the model). pgvector in the existing Supabase project would also work. Neither is needed now.

## 3. Architecture
```
browser (Ask box / Plan form)
   |  POST { text, today: {dow, minute} }           (text <= 200 chars)
   v
Supabase Edge Function `parse-request`  ── secret GEMINI_API_KEY (never in the browser)
   |  Gemini generateContent, structured output (JSON schema, enums for ids)
   v
{ intent, building_id, place_id, dow, minute, permits[], ada, confidence, unresolved[] }
   |  validated in the browser against the real id lists and ranges
   v
existing deterministic code: nearest / plan-ahead lookup / permit verdicts  -> answer
   ^
   └─ on timeout (2 s), error, quota, or invalid output: the current rule-based parser answers instead
```
The provider is behind one function, so it can be swapped (Databricks Foundation Model API, another vendor) without touching the app. Whether Databricks
Foundation Model APIs are available on Free Edition is unconfirmed; check before promising it in the pitch.

## 4. Contract
Request: `{ "text": string (<=200 chars), "today": { "dow": 1-7, "minute": 0-1439 } }`.

Response (all fields validated client-side; anything invalid is treated as "unresolved"):
```json
{
  "intent": "plan_ahead | nearest | status | most_open | permit_info | accessible | unknown",
  "building_id": "b0153 | null",
  "place_id": "lot-squires | perry-street | null",
  "dow": 1,
  "minute": 840,
  "permits": ["cg"],
  "ada": false,
  "unresolved": ["time"]
}
```
Rules: ids must exist in the app's lists; `dow` 1-5 (weekends map to the replay day the app already uses, or ask); `minute` 0-1439; permits from the app's `PermitId` set;
relative words ("tomorrow", "this afternoon") are resolved by the model using `today`, but the client re-validates the result. If anything needed for the intent is missing,
the app asks one short follow-up in the UI rather than guessing.

## 5. Prompt design
System prompt states the task, gives the closed lists (`id | name | aliases` for buildings and places, the permit ids with plain descriptions), and requires the schema.
User text is passed as data. Prefer the API's schema-constrained output / function calling with `enum`s over free-form JSON.
No user identifiers, location, or permit history are sent; only the typed text and today's weekday and time.

## 6. Safety, privacy, abuse
* **Prompt injection:** output is schema- and enum-constrained and validated; the worst outcome is a wrong intent or "unknown". The model has no tools and no access to secrets or data.
* **Key exposure:** the key lives only as a Supabase secret. The anon key is public, so it is **not** protection against abuse.
* **Abuse and cost:** input cap 200 chars, per-visitor rate limit (for example 20 requests per 10 min, stored in a small table), CORS restricted to the deployed site, and a global daily cap that flips the function to "unavailable" (the app then uses the rule-based parser).
* **Privacy:** on Google's free tier, inputs may be used to improve Google's products and can be human-reviewed; paid tiers do not. Show a one-line notice near the box ("Typed questions are processed by Google Gemini"), tell users not to enter personal details, and log nothing beyond counters.
* **Quotas:** free-tier limits are on the order of 10-15 requests/minute and 250-1,000/day by model (third-party summaries; confirm in Google AI Studio). Ample for a demo; not for production.

## 7. Reliability and UX
* Hard timeout 2 s; on any failure fall back to the current rule-based parser with no error shown.
* A small "AI-assisted" / "basic" indicator on each answer so behaviour is legible.
* The structured form (building picker, day, time, permit) remains the primary, always-available path.

## 8. Testing
* Golden set of ~30 phrasings (typos, nicknames, relative times, no-permit, accessible, ambiguous) with expected structured output.
* Mocked Gemini in unit tests (no network): valid output, invalid ids, out-of-range time, injection strings, timeout, quota error, malformed JSON.
* Side-by-side report: rule-based parser vs model on the golden set, so the value is measured rather than assumed.
* Never test against the live key in CI.

## 9. Effort and setup
| Piece | Estimate |
| --- | --- |
| Edge function, prompt, schema, validation, rate limit | ~1.5 h |
| App integration through the existing `Answerer` seam, fallback, indicator | ~1 h |
| Tests and golden set | ~1 h |
| **Total** | **~3.5-4 h** (about 2 h without the golden-set comparison) |

User steps (~20 min): create a Gemini API key in Google AI Studio; `supabase secrets set GEMINI_API_KEY=...`; deploy the function (Supabase CLI or the dashboard editor); add the function URL to `.env.local` and the GitHub Actions variables.

## 10. Decisions still open
1. Ship it at all? It depends on the plan-ahead recommender (its outputs are exactly that feature's inputs) and is optional for the demo.
2. Provider: Gemini (free tier, privacy caveat) vs a Databricks-hosted model (better track story, availability unconfirmed).
3. Privacy stance for a public demo: notice only, or keep the feature off by default behind a toggle.
