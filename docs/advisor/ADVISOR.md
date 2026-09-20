# Parking advisor (OpenRouter or Gemini): what was built and how to turn it on

Status: **built 2026-09-19; the relay speaks OpenRouter (default) or Gemini; tested without a key; not yet run against a real model through OpenRouter.** Off by default (`HOKIEPARK_ADVISOR=1` turns it on).
This replaced the earlier "LLM parses the request" proposal with a tool-using advisor, because that gives the Ask tab a real purpose.

## 1. What it is for
Ask stays the place for messy, real-life questions that a form cannot take:
* "I have Torgersen at 2 then Goodwin at 3:30, commuter permit, I hate walking, what should I do?" (several tool calls, then one plan)
* trade-offs in plain words ("Perry is closest but likely full then; the lot 12 minutes away is safer")
* "when should I arrive to still get a spot?" (a question the Plan form cannot answer)
* permit questions ("can I park at Squires with my permit, and what should I check?")
The **Plan** tab remains the reliable structured path; Ask is the conversational one. Ask never depends on the advisor: any failure falls back to the rule-based assistant, visibly.

## 2. The rule that makes it safe: the model never supplies facts
The model only **chooses tools and explains their results**. Deterministic tools run in the browser on the app's own data:
| Tool | What it returns |
| --- | --- |
| `find_place` | building / garage / lot candidates for a name, nickname or timetable code (TORG, MCB, GBJ) |
| `plan_parking` | the Plan tab's ranked, permit-confirmed recommendations for a building, weekday and class time, plus unconfirmed nearby places |
| `parking_now` | nearest places with the map's current counts |
| `arrival_advice` | forecast by arrival time (up to 90 min before class) and the latest arrival that is not forecast risky |
| `permit_check` | whether a permit is valid at a lot or garage (per level), with the reason |
| `garages_now` | garages ranked by open spaces right now (and on the levels the permit covers) - answers "which garage has the most open spots" |
| `accessible_parking` | nearest lots with designated accessible spaces and the nearest garage with accessible spaces open, near a place or campus-wide |
| `resolve_destination` | building-only result with explicit `resolved`, `ambiguous`, or `not_found` status |
| `get_lot_details`, `get_eligible_lots`, `get_parking_forecast`, `get_ticket_risk` | stable canonical facts for UI and agent use; forecast sources are always marked simulation |
| `get_current_location` | availability only; coordinates remain local to route execution |
Guards, all enforced in code and mutation-tested:
1. **Number guard:** every number in the answer must appear in a tool result, the driver's own message, or the context line (the current time). Otherwise the answer is discarded and the rule-based one is used.
2. **Place guard:** the final `PLACES:` line may only name places a tool actually returned.
3. **Disclaimers are added by code, not by the model:** forecasts are labelled simulated (with the Databricks model version); counts are labelled demo data; the posted-signage note is always appended.
4. **Fallback:** network error, timeout (12 s), Gemini quota, malformed turn, oversized input or a guard failure all return the rule-based answer, tagged "Basic answer" with the reason on hover.
5. Permit safety is inherited: the tools use the same permit rules as the map, so an unconfirmed place is never described as fine.

## 3. Architecture
```
browser Ask tab ── agent loop (src/lib/advisor.ts) ── runs tools locally (src/lib/advisor-tools.ts, your real data + forecast)
      │  POST { contents, context: {now, permits, ada} }  (no key, no system prompt, no tools)
      ▼
Supabase Edge Function `advisor` (supabase/functions/advisor)  ── secret OPENROUTER_API_KEY (or GEMINI_API_KEY)
      │  adds the system prompt + tool declarations itself, validates and rate-limits, relays ONE model turn
      ▼
OpenRouter chat completions (OpenAI format) or Gemini generateContent  ->  next model turn (text or function calls)  ->  back to the browser, which runs the tools and loops (max 6 rounds / 15 calls)
```
Why the loop runs in the browser: the tools need the app's data (buildings, lots, permit rules, forecast, live counts), so nothing is duplicated on the server. The model's turns are stored and re-sent verbatim, which also preserves any "thought signature" a newer Gemini model requires.

The server is a thin, defensive relay (`handler.ts`): the key is a function secret and is never echoed; callers cannot change the system prompt, add tools, or pick the model; requests are validated (roles, tool names, sizes, permit ids) and size-limited; per-visitor (default 60 per 10 min) and daily (default 1,500) rate limits; CORS allow-list; upstream errors map to safe statuses (503 quota, 502 rejected, 504 timeout). The function bundles into ONE file (`npm run advisor:build`), so it can be pasted into the Supabase dashboard without the CLI.

### Routing and accessibility additions

The advisor also exposes `calculate_walk_route`, `compare_parking_options`, and `build_arrival_plan`. Comparison reuses the existing `planAhead` ranking rather than asking the model to score lots. Arrival plans work backward from a target class time with a disclosed parking-search estimate, deterministic walking duration, and user buffer; they deliberately omit a leave-home time because HokiePark has no reliable driving-time source.

The routing core uses deterministic A* over Virginia Tech Facilities’ public **Sidewalks and Pathways** graph (`src/data/walkways.geo.json`; refresh with `npm run walkways`). Connected routes return `walk_graph` geometry and ETA. When a pair of snapped points is disconnected, the tool falls back to a clearly labelled `straight_line_estimate`; it never claims turn-by-turn navigation in that case. The graph reflects the downloaded data snapshot, so refresh and verify it before a future deployment.

Browser location is obtained only after the normal map permission request and lives only in short-lived app memory. It can be used by local deterministic route tools, but `httpTransport` strips it from requests to the advisor relay/model; a regression test verifies this boundary.

Ask responses stream a compact list of the real tools running and then collapse into their completed state (not hidden model reasoning). Browser-native read-aloud, pause, resume, and stop controls support persisted speech speed and optional auto-read. The accessibility panel also persists larger text and reduced-motion preferences. Optional browser voice input only fills the editable chat field; it never submits a partial transcript. Speech never reads agent activity or raw coordinates.

## 4. Providers, and turning it on (your steps, about 20 minutes)
The relay translates the app's one turn format to the provider's API and back (`supabase/functions/advisor/providers.ts`), so the client, tools and guards never change. **OpenRouter is used when `OPENROUTER_API_KEY` is set; otherwise Gemini if `GEMINI_API_KEY` is set.**

**OpenRouter (recommended):**
1. **Key:** openrouter.ai -> Keys -> Create key. Free models need no card.
2. **Privacy setting for free models:** free models are served by providers that may log or train on prompts. OpenRouter's account privacy settings control whether requests may be routed to such providers; if the check reports `404 No endpoints found matching your data policy`, allow them there (not verified from here). Only the typed question, weekday/time and saved permit ids are sent.
3. **Optional but decisive:** free models allow about 20 requests/minute and **50 requests/day until you have bought $10 of credits, then 1,000/day** (third-party summaries; confirm at openrouter.ai/docs/api-reference/limits). One question uses 2-4 model calls.
4. **Deploy the function:** Supabase -> Edge Functions -> `advisor` -> editor: select all, delete, paste the whole of `supabase/functions/advisor/index.ts`, Deploy. **Replace ALL template code.** If `check:advisor` reports a 401 with a publishable key, turn **Verify JWT** OFF in the function's Settings and redeploy (or drop `HOKIEPARK_ADVISOR_KEY`).
5. **Secrets** (Edge Functions -> Secrets): `OPENROUTER_API_KEY` = your key; `OPENROUTER_MODEL` = up to 3 model ids separated by commas (tried in order by OpenRouter's own fallback routing), for example `qwen/qwen3.8-27b:free,nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free` (free tool-capable models seen in OpenRouter's catalogue on 2026-09-19; the free roster changes, so check `openrouter.ai/models?max_price=0`; the default `openrouter/free` picks one for you); `ALLOWED_ORIGINS` = `https://heuyz14.github.io,http://localhost:8080`. Optional `OPENROUTER_REFERER`.
6. **Local:** `.env.local` gets `HOKIEPARK_ADVISOR=1` and `HOKIEPARK_ADVISOR_KEY=<sb_publishable_ key>` (Supabase -> Project Settings -> API Keys; the legacy anon key is rejected by new functions' gateway). Then `npm run check:advisor`: it asks the three spec questions plus a plan-ahead question through the real model and prints the rule-based answers next to them.
7. **Deployed site:** GitHub -> Settings -> Secrets and variables -> Actions -> Variables: `HOKIEPARK_ADVISOR` = `1` and `HOKIEPARK_ADVISOR_KEY` = the publishable key, then re-run "Deploy to Pages".
8. **Off / rollback:** remove the variable and rebuild (Ask reverts to rules), or delete the function (the app falls back). To go back to Gemini, delete `OPENROUTER_API_KEY` and keep `GEMINI_API_KEY` / `GEMINI_MODEL` (comma-separated fallbacks, tried in order).

## 5. Privacy, cost, limits (say these out loud)
* **Prompts go to a third party.** OpenRouter routes to hosted providers; on free models those providers may log or train on inputs (Gemini's free tier likewise). The Ask greeting says so and asks people not to type personal details. Only the typed text, the weekday/time and the saved permit ids are sent; no location and no identifiers.
* **Budget:** OpenRouter free: ~20 requests/min, 50/day (1,000/day after a one-time $10 credit purchase). Gemini free: a few to ~15 requests/min and 250-1,000/day depending on the model, with frequent "high demand" 503s. One question is 2-4 requests. When a limit is hit the app falls back to the rule-based assistant and says so ("Basic answer").
* **Latency:** hosted free models can be slow (several seconds per call, 2-4 calls per answer); the client waits up to 25 s, then falls back. The UI shows "Thinking it through...".
* **Quality is model-dependent:** free models vary in how reliably they call tools. The guards (number guard, place guard, fallback) make a weak model fail safe, not wrong; `check:advisor` shows whether the chosen models behave.
* Wrong parses are bounded: a mistaken building or time still yields a grounded answer for what was understood; the Plan form is the exact path.

## 6. Verification status
* **Tested locally, no key:** 40+ tests: tool behaviour and argument validation; the agent loop with a scripted model (grounded answer, thought signature round-trip, guard rejections, missing permit, prompt-injection attempt, rounds/timeout/transport failures, follow-up context); the server handler with a fake Gemini (key never leaks, caller cannot override prompt/tools/model, validation, rate limits, CORS, error mapping); a full-chain test (agent -> handler -> fake model); and a browser test through the smoke harness (AI badge, no-permit question, grounded answer, minimal request body, visible fallback).
* **Deliberately broken to prove the tests bite:** the number guard, the place guard, thought-signature preservation, the tool-name check, the rate limit, the origin allow-list, and key leakage each make a specific test fail.
* **Verified with real Gemini (partially):** the deployed relay reached Gemini and the off-topic refusal worked; tool-using questions hit Gemini's own 429/503 (quota / high demand) before completing, which motivated the move to OpenRouter.
* **Verified locally for the three spec questions:** the new tools return the same garage, lot and accessible-space numbers as the rule-based assistant, and the full chain (agent -> relay -> fake OpenRouter model -> real tools) reproduces them; failures (429, 402, timeout, malformed reply) degrade to the rule-based answer.
* **NOT verified:** a real model through OpenRouter (tool-calling reliability of the free models, latency, whether the free-model privacy setting blocks routing) and the redeployed function. `npm run check:advisor` is the first real test. Expect some tuning of the system prompt (`src/lib/advisor-spec.ts`) or the model list, then `npm run advisor:build` and re-paste.
