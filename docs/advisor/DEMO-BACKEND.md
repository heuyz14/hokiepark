# Parker interview backend

The app sends one question plus up to six text-only history turns and permit/accessibility preferences. The server supplies the Virginia Tech time zone, reads and validates Supabase `garage_levels`, clones the campus dataset for this request, and executes parking tools. OpenRouter or Gemini may choose tools and phrase their results; API keys stay on the server. No model key is required for the basic backend answer. To preserve location-based model tools, browser-authorized coordinates are forwarded only when the question explicitly asks about the current location; the chat notice explains this. Coordinates remain absent from ordinary parking questions.

This is a presentation backend, not a production parking service. Occupancy is simulated. Forecasts are bundled model output trained on simulated labels, not live measurements or validated real-world accuracy. Unknown permit rules still require signage checks. Browser and server can read different snapshots; use the backend timestamp when explaining an answer. A failed DB read uses clearly labelled bundled simulation. A failed model uses backend rules; an unreachable backend uses visibly labelled local rules.

## Local demo

1. `npm run backend:dev` starts `http://localhost:8788/api/parking-chat`. Existing ignored `.env.local` public Supabase config is reused; optional server-only `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` or Gemini equivalents enable model phrasing. Never put provider keys into `HOKIEPARK_` browser variables.
2. In a separate terminal build with `HOKIEPARK_ADVISOR=1 HOKIEPARK_ADVISOR_URL=http://localhost:8788/api/parking-chat npm run build`.
3. Serve `dist` locally with any static server (for example `python3 -m http.server 4173 --directory dist`). Open the local page, not the older hosted build. Clear the service worker/cache if an old page persists.
4. Ask “I have a 2pm class at Torgersen with a commuter permit. Where should I park?” Show the result, simulated forecast disclosure, and backend tool activity.
5. Ask “Which garage has the most open spaces?” Show the POST response in the browser Network view: `provenance.execution`, `source`, `dataAsOf`, and `answer.tools`. Permit-covered levels may have zero spaces without the entire garage being full.
6. Stop the backend and ask again to demonstrate the labelled local fallback. Restart before presenting.

Keep the whole live demo to 3–4 minutes. Without a provider key, call the answer a rule-based backend response, not a live LLM response. Model orchestration is covered by a mocked provider integration test; this does not establish live provider quality.

## Hosted rebuild

Run `npm run advisor:build`; deploy the generated `supabase/functions/advisor/index.ts` as the existing advisor Edge Function (or use the repository's Supabase workflow). Automatic `SUPABASE_URL` and `SUPABASE_ANON_KEY` provide the DB read. Configure server provider keys if desired and restrict `ALLOWED_ORIGINS` to the site origin. Build the frontend with `HOKIEPARK_ADVISOR=1` and its public Supabase settings, then publish the rebuilt `dist`. Backend and frontend must be released together. No schema change or service-role key is needed.

The legacy `{contents, context}` relay remains for older clients. The current app uses `{question, history, context}` and rejects supplied tool responses on that path. This work has not deployed either hosted component.

## Verification

`npm run check` checks types, unit/integration tests, and frontend build. `npm run advisor:build` refreshes the deployable bundle. Tests cover DB-derived counts, no shared-data mutation, DB outage disclosure, rejection of forged tool results, client privacy boundary, transport fallback, and server execution of model tool calls.

The local HTTP endpoint was also exercised against the configured read-only Supabase simulation with garage and class-planning questions. No production data was written. There is no measured user adoption, time saved, or real parking forecast accuracy to claim.

## November 10 follow-up and arrival regression checks

Live browser checks on the existing hosted release confirmed the Torgersen class question, permit-only follow-up, Hancock/time correction, current-garage intent, lot details, Squires permit rejection, accessible-parking query, and the Coliseum West map link. The recorded model tool call for “Actually, Hancock at 10am” used Hancock, Wednesday, 10:00, and C/G. Wednesday's stored simulation has the same 47% fullness at the 09:45 and 13:45 forecast buckets, so both class questions can legitimately return 392 spaces. That is not evidence of a stale time.

The arrival-advice check exposed a separate defect: the tool selected a late parking arrival based only on forecast risk, without reserving walking/search/buffer time. Arrival candidates now use the shared arrival-plan budget; a 10am Hancock class requires arriving at Coliseum West by 09:33 (4 minutes parking + 18 walking + 5 buffer), or Stadium by 09:26 (4 + 25 + 5). These are simulated estimates, not guarantees, and do not include driving to campus. Arrival text is rendered from calculated tool fields so model wording cannot replace the deadline with 09:55.

Regression tests cover both the deadline budget and suppression of unsafe model wording. The local HTTP endpoint and browser return the corrected times. Stopping the local backend was also tested: the browser returned a visibly labelled local fallback; the backend was restarted afterward. Publish the rebuilt frontend and advisor function together to apply this fix to the public demo. Hosted behavior is not changed by a local test or git push.

## Map location wording fix — November 10

The browser previously recognized different location phrases in the UI permission check and the request sender. “I can see myself on the map” matched neither, so an existing map position was omitted from the backend request. `location-intent.ts` now provides one shared rule, including references to seeing oneself on the map, the blue dot, current position, and nearby/from-here requests. The chat reuses a known map location instead of reacquiring it. Ordinary parking questions continue to omit coordinates.

Verification used a synthetic Drillfield position, not the user's real position: the map displayed its location marker; the exact reported phrase forwarded location and received a real hosted AI response confirming availability. A follow-up walking question returned a route to Torgersen with only one location acquisition total. Automated regression coverage checks the phrase set, ordinary-question privacy boundary, and backend location-tool availability without exposing exact coordinates to the model. 267 tests, type checking, build, and the simulated-live browser suite passed. This is frontend-only: publish Pages after CI; no advisor function redeploy is needed for this change.

## Expanded GPS nearby-parking check — November 10

After deploying 7496771, live checks confirmed location forwarding and a walking route from a synthetic campus position. An additional question, “Where can I park near me with a commuter permit?”, exposed a separate tool gap: `parking_now` previously accepted only known place IDs, not a granted current-location origin. The model drifted back to the previously discussed building instead of finding parking near the driver.

The backend now supports `place_id: current_location` with validated request coordinates. Explicit near-me parking queries run a deterministic backend lookup, using existing distance, simulated occupancy, and permit rules. They do not ask the model to invent a nearby origin or replace GPS with chat history. Missing coordinates prompt the user to allow location; prior destinations are not substituted. The resulting basic backend answer is intentional and is distinct from an unavailable-backend/local fallback. Walking durations in this lookup are explicitly marked straight-line estimates. No exact coordinates are returned in the tool result.

Three regression tests cover the GPS origin, stale-destination isolation, and missing-location case. The full suite now passes 270 tests, type checking and build; both simulated-live and bundled-data browser suites pass. A local browser using a synthetic campus position returned nearby C/G-compatible options and opened the correct map detail. All other main live demo flows were retested on 7496771, including permit follow-up, Hancock/time correction, arrival advice, accessibility, and offline recovery. The new near-me lookup requires updating only the advisor function; the currently deployed Pages request contract is compatible.

## Ordinary class-plan timing correction — November 10

Post-deployment testing confirmed that GPS-based nearby parking now works publicly. It also caught a remaining timing ambiguity in ordinary plan_parking replies: the tool's old arrive_time field was the forecast sampling time (15 minutes before class), which the model sometimes described as sufficient parking arrival despite a longer walk. The separate arrival_advice fix did not cover this ordinary planning path.

plan_parking now reports forecast_time separately from each option's parking_arrival_time. Parking deadlines use the shared parking-search + walking + class-buffer calculation. Model plan prose is rendered from these calculated fields, preserving forecast counts, permit caveats and multiple requested class plans. Unsupported model numbers remain rejected. This prevents the sampled 13:45 forecast from becoming an impossible deadline for a 14:00 Torgersen class with a 21-minute walk; its calculated parking deadline is 13:30. Hancock at 10:00 remains 09:33.

272 automated tests, type checking and build passed. Regression coverage includes unsafe ordinary-plan wording, distinct forecast/deadline fields, unsupported-number rejection, and multiple destinations. The updated local tool runner was also exercised with the real hosted provider relay for Torgersen 14:00 and the Hancock 10:00 follow-up; both returned correct calculated deadlines. Updating the advisor function applies this chat correction; the existing Pages request contract remains compatible. The separately noted structured-Plan headline wording is unchanged.

## Concise Parker wording — November 10

Single-class answers now display Best plus at most one Alternative, keeping each option's walking estimate, forecast count and calculated parking deadline. Unconfirmed lots are omitted when confirmed choices exist; when none exist, permit caveats are retained. The timing assumptions and simulation/signage warnings are compact. The visible source note uses a readable Eastern-time timestamp while full provenance remains in the response JSON. No lookup or timing calculations changed. The model prompt requests no more than 80 words and avoids repeating application-generated source/disclaimer text. A representative two-option class reply is approximately 74 words, with at most two displayed map references. A regression test checks brevity, labels, deadline retention and absence of unshown options. 273 tests, type checking and build pass.
