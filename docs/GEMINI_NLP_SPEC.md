# Parking advisor (Gemini): what was built and how to turn it on

Status: **built 2026-09-19, tested without a key, not yet run against real Gemini.** Off by default (`HOKIEPARK_ADVISOR=1` turns it on).
This replaced the earlier "LLM parses the request" proposal with a tool-using advisor, because that gives the Ask tab a real purpose.

## 1. What it is for
Ask stays the place for messy, real-life questions that a form cannot take:
* "I have Torgersen at 2 then Goodwin at 3:30, commuter permit, I hate walking, what should I do?" (several tool calls, then one plan)
* trade-offs in plain words ("Perry is closest but likely full then; the lot 12 minutes away is safer")
* "when should I arrive to still get a spot?" (a question the Plan form cannot answer)
* permit questions ("can I park at Squires with my permit, and what should I check?")
The **Plan** tab remains the reliable structured path; Ask is the conversational one. Ask never depends on the advisor: any failure falls back to the rule-based assistant, visibly.

## 2. The rule that makes it safe: the model never supplies facts
The model only **chooses tools and explains their results**. Five deterministic tools run in the browser on the app's own data:
| Tool | What it returns |
| --- | --- |
| `find_place` | building / garage / lot candidates for a name, nickname or timetable code (TORG, MCB, GBJ) |
| `plan_parking` | the Plan tab's ranked, permit-confirmed recommendations for a building, weekday and class time, plus unconfirmed nearby places |
| `parking_now` | nearest places with the map's current counts |
| `arrival_advice` | forecast by arrival time (up to 90 min before class) and the latest arrival that is not forecast risky |
| `permit_check` | whether a permit is valid at a lot or garage (per level), with the reason |
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
Supabase Edge Function `advisor` (supabase/functions/advisor)  ── secret GEMINI_API_KEY
      │  adds the system prompt + tool declarations itself, validates and rate-limits, relays ONE model turn
      ▼
Gemini generateContent  ->  next model turn (text or function calls)  ->  back to the browser, which runs the tools and loops (max 4 rounds)
```
Why the loop runs in the browser: the tools need the app's data (buildings, lots, permit rules, forecast, live counts), so nothing is duplicated on the server. The model's turns are stored and re-sent verbatim, which also preserves any "thought signature" a newer Gemini model requires.

The server is a thin, defensive relay (`handler.ts`): the key is a function secret and is never echoed; callers cannot change the system prompt, add tools, or pick the model; requests are validated (roles, tool names, sizes, permit ids) and size-limited; per-visitor (default 60 per 10 min) and daily (default 1,500) rate limits; CORS allow-list; upstream errors map to safe statuses (503 quota, 502 rejected, 504 timeout). The function bundles into ONE file (`npm run advisor:build`), so it can be pasted into the Supabase dashboard without the CLI.

## 4. Turn it on (your steps, about 20 minutes)
1. **Gemini key:** Google AI Studio -> Get API key -> Create. Look at the models list there and note a current "flash" model name (model ids change; the function defaults to `gemini-2.5-flash`).
2. **Deploy the function:** Supabase dashboard -> Edge Functions -> Deploy a new function -> name it exactly `advisor` -> open the editor, paste the whole of `supabase/functions/advisor/index.ts` -> Deploy. **Replace ALL the template code** (delete it first). After deploying, if `check:advisor` reports a 401 with a publishable key, open the function's Settings and turn **Verify JWT** OFF (a publishable key is not a JWT; the function validates and rate-limits every request itself), then redeploy. Alternatively drop `HOKIEPARK_ADVISOR_KEY` so the legacy anon JWT is used, which passes JWT verification.
3. **Secrets** (Edge Functions -> Secrets): `GEMINI_API_KEY` = your key; `GEMINI_MODEL` = the model name from step 1 (optional if the default still exists); `ALLOWED_ORIGINS` = `https://heuyz14.github.io,http://localhost:8080`.
4. **Local:** add `HOKIEPARK_ADVISOR=1` to `.env.local`. **Also add `HOKIEPARK_ADVISOR_KEY=` with the PUBLISHABLE key** (Supabase -> Project Settings -> API Keys -> Publishable key, `sb_publishable_...`): new Supabase functions reject the legacy JWT anon key with `INVALID_API_KEY` (your feed can keep using the legacy key). It is public by design; never use the secret key. Then `npm run check:advisor`. It calls the deployed function through the real agent loop with 4 scenarios (including an off-topic one that should be declined) and tells you exactly what is wrong if anything fails. Then `npm run build` and open the Ask tab: the greeting names the advisor and answers carry an "AI advisor" badge.
5. **Deployed site:** GitHub -> Settings -> Secrets and variables -> Actions -> Variables -> add `HOKIEPARK_ADVISOR` = `1` and `HOKIEPARK_ADVISOR_KEY` = the publishable key, then re-run "Deploy to Pages".
6. **Switch it off any time:** remove the variable / `.env.local` line and rebuild; Ask reverts to the rule-based assistant. Deleting the function also just makes the app fall back.

## 5. Privacy, cost, limits (say these out loud)
* On Google's **free tier, inputs may be used to improve Google's products and can be human-reviewed**; paid tiers are not. The Ask greeting says typed questions are understood with Gemini and asks people not to type personal details. Only the typed text, the weekday/time, and the saved permit ids are sent; no location and no identifiers.
* Free-tier quotas are on the order of 10-15 requests per minute and 250-1,000 per day by model (third-party summaries; confirm in AI Studio). One question uses 2-4 model calls (one per tool round), so a demo is fine and a crowd is not; the daily cap flips the app to the rule-based assistant.
* Latency is roughly 2-6 seconds per answer (several sequential calls); the UI shows "Thinking it through...".
* Gemini is off-platform for a Databricks track. The provider sits behind one function, so a Databricks-hosted model could replace it; whether Databricks Foundation Model APIs are available on Free Edition is unconfirmed.
* Wrong parses are bounded: a mistaken building or time still yields a grounded answer for what was understood, shown with the tools' own words; the Plan form is the exact path.

## 6. Verification status
* **Tested locally, no key:** 40+ tests: tool behaviour and argument validation; the agent loop with a scripted model (grounded answer, thought signature round-trip, guard rejections, missing permit, prompt-injection attempt, rounds/timeout/transport failures, follow-up context); the server handler with a fake Gemini (key never leaks, caller cannot override prompt/tools/model, validation, rate limits, CORS, error mapping); a full-chain test (agent -> handler -> fake model); and a browser test through the smoke harness (AI badge, no-permit question, grounded answer, minimal request body, visible fallback).
* **Deliberately broken to prove the tests bite:** the number guard, the place guard, thought-signature preservation, the tool-name check, the rate limit, the origin allow-list, and key leakage each make a specific test fail.
* **NOT verified:** real Gemini behaviour (does the model pick tools sensibly, do its numbers pass the guard, latency, quota) and the deployed function. `npm run check:advisor` is the first real test. Expect some tuning of the system prompt (`src/lib/advisor-spec.ts`), then `npm run advisor:build` and re-paste.
