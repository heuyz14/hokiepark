# HokiePark demo runbook

Updated 2026-09-20. Live site: **https://heuyz14.github.io/terraceb/** (GitHub Pages, public HTTPS, installable on iPhone).

## What you are demoing
| Piece | What it is | Honest label |
| --- | --- | --- |
| **Map** | Real VT GIS footprints (102 buildings, 85 lots, 2 garages) on an OpenFreeMap basemap | Real geography |
| **Live counts** | Supabase table, updated every minute by `pg_cron`, shown in the header chip (`Live . 12s ago`) | **Simulated** occupancy shaped by VT's class timetable |
| **Permit filter** | "Set your permit" dims what you cannot use; ADA lots are never dimmed | VT's 2026-27 Quick Guide rules; 66 of 85 lots have no known class ("check the sign") |
| **Plan tab** | Building + weekday + class time + permit -> top 3 places with walk time and forecast fullness at arrival | Forecast from the **Databricks-trained model** on simulated demand |
| **Ask (advisor)** | Natural-language parking advisor: an AI model picks tools and explains their results; every number comes from the app's own data | AI model via OpenRouter; guarded (see below) |
| **Databricks** | Delta tables in Unity Catalog, Monte Carlo training data, MLflow-tracked gradient-boosted model, batch-scored `predictions.json` | Trained on **simulated** labels: measures recovery of the simulation, not real-world accuracy |

## Before you present (15 min)
1. **Site:** open the live URL on the phone. Chip reads `Live`, the map draws (needs internet and WebGL), all four tabs load.
2. **Feed:** `npm run check:supabase` -> PASS lines and `newest row updated 0-1 min ago`. In Supabase: `select jobname, schedule, active from cron.job;` -> `hokiepark-simulate`, `* * * * *`, `active`.
3. **Clock:** `update public.sim_config set clock_override = null;` (real clock; weekends replay a typical Wednesday).
4. **Advisor:** `npm run check:advisor` -> `6/6 questions answered by the advisor` (each answer 2-4 s). It costs about a quarter of a cent per question. If it says `basic`, read the reason (table below) before presenting.
5. **OpenRouter credits:** confirm the balance is not empty (a paid model runs first, a free model is the last fallback).
6. **Fallback screenshots:** `docs/fallback/` is from an OLDER build (before the Plan tab, advisor and the new map). Retake them on the demo machine from the live site.
7. **Network backup:** keep a phone hotspot ready. The map tiles and the advisor need internet; the rest of the app degrades gracefully.
8. **Install test:** iPhone Safari -> Share -> Add to Home Screen, then open it from the home screen once.

## Suggested flow (about 3 minutes)
1. **Problem (10 s).** "Everyone at VT has a parking story. The live map says what is open now, but you need to know what it will look like when you arrive."
2. **Map (25 s).** Real VT GIS data. Tap Perry Street Garage: level breakdown, ADA spaces per level. Open "Set your permit", choose Commuter/Graduate: places you cannot use dim, accessible spaces stay visible.
3. **Plan (40 s).** Plan tab -> Hancock Hall, Wednesday, 2:00 PM, Commuter/Graduate. Expect **Coliseum West lot: Likely open, about 392 forecast open of 740, 12-minute walk** and Stadium lot second. Say: "It never sends a plain commuter permit to Perry Street Garage, and lots whose signage we cannot confirm are listed separately as 'check the sign'." Then add the Perry permit: Perry Street Garage appears as **Risky**. That contrast is the point of a forecast.
4. **Ask (50 s).** Type these (numbers move with the live tick; they must match what the map shows):
   | Question | What you should see |
   | --- | --- |
   | "Which garage has the most open spots right now?" | Names the garage with the most open spaces (North End Center or Perry) with the same counts as the map |
   | "Is there accessible parking near Cassell Coliseum?" | Coliseum West lot, 12 designated accessible spaces; Bookstore lot 6; Perry Street Garage accessible spaces open now |
   | "I have a 2pm class in Hancock Hall on Wednesday, commuter permit. Where should I park?" | Coliseum West with the forecast open count and walk time, unconfirmed nearby lots flagged, a "SIMULATED" note |
   | "When should I arrive at Hancock Hall for a 10am class to still find a spot?" | It asks which permit you hold. Reply just "commuter": it completes the SAME question and names an arrival time |

   Point at the **AI advisor** badge. Say: "The model only chooses tools and phrases the result. If it writes a number the tools did not return, the answer is rejected and you get the built-in answer, badged Basic."
5. **Databricks (30 s).** "The forecast behind Plan comes from a pipeline on Databricks: the public class timetable into Delta tables in Unity Catalog, a Monte Carlo simulator for training labels because no real occupancy history exists, a gradient-boosted model tracked and registered in MLflow, batch-scored into a lookup the app reads with no live dependency." Show the MLflow experiment and the registered model if you have the workspace open. Full story and a 30-second version: `docs/DATABRICKS_ML.md`.
6. **Honesty line (10 s).** "Occupancy here is simulated; the model recovers that simulation, it is not validated against sensors. With real sensor history the same pipeline becomes a real forecast."

## Moments to jump to (live counts)
The live counts follow the curve for the current time. On weekends they replay Wednesday. To show a busy moment, set the clock and tick (with the every-minute cron a full swing takes about 15 minutes, so also tick by hand to hurry it):
```sql
update public.sim_config set clock_override = '08:50';
select public.simulate_occupancy_tick();   -- run ~15 times
```
| Clock | Whole garage (Perry / North End) | Perry L1 (commuter/grad) | What to say |
| --- | --- | --- | --- |
| 07:30 | 32% / 33% | 18% | Early morning: plenty of room |
| 08:50 | 82% / 83% | 64% | Class rush building; Perry L2-L4 already full |
| 10:30 | 95% / 95% | 95% | Peak: commuter level nearly full, only roof spaces left |
| 15:00 | 91% / 91% | 84% | Afternoon plateau |
| 17:30 | 39% / 37% | 47% | Draining after the last classes |
| 20:00 | 14% / 14% | 9% | Evening |

Reset afterwards: `update public.sim_config set clock_override = null;`
Exact scenario: `update public.garage_levels set occupied = capacity - 3 where garage_id = 'perry-street' and level_index = 1;` (the next tick pulls it back toward the curve; pause cron with `select cron.unschedule('hokiepark-simulate');` to hold it, restore with `supabase/optional/schedule_simulator.sql`).

## If something breaks
| Symptom | Cause | Fix |
| --- | --- | --- |
| Ask answer badged **Basic answer . AI unavailable** | The relay or provider failed (overload, quota, no credits, key) | Keep presenting: the basic answer is correct, just less conversational. Later: `npm run check:advisor` shows the reason. Check OpenRouter credits and status |
| **Basic answer . AI too slow** | A model took over 25 s | Retry once; the model list falls back automatically |
| **Basic answer . AI answer rejected** | The number guard caught a number the tools did not return (this is the guard working) | Rephrase or move on; `check:advisor` prints what the model wrote |
| Ask never shows the AI badge at all | Advisor variables missing in the deployed build | Add `HOKIEPARK_ADVISOR=1` and `HOKIEPARK_ADVISOR_KEY` as GitHub Actions variables and re-run "Deploy to Pages" |
| Map area says "WebGL2 required" or is blank | Browser without WebGL, or the tile server is unreachable | Use a normal browser/phone, or the hotspot; the List, Plan and Ask tabs still work |
| Chip says `Offline` | Network / Supabase outage | App keeps last counts; keep presenting, or show the fallback screenshots |
| Chip says `Data 12m ago` (or `4h ago`) | Nothing is ticking | Check `cron.job` (see step 2), or run the tick by hand |
| Chip says `Sample data` | The deployed build has no Supabase values | Set the two Supabase Actions variables and re-run "Deploy to Pages" |
| Counts look frozen after changing the clock | A tick moves a level at most ~8% of its capacity | Run the tick ~15 times |
| Everything is 95% full | Working as designed at peak | Jump to 07:30 or 20:00 |
| Site changed but the deployed page did not | Pages only redeploys when you run the workflow | Actions -> Deploy to Pages -> Run workflow |

## Do NOT claim
- Real sensors, measured occupancy, or a forecast validated against real data (all labels are simulated).
- That class density measures garage demand: both garages are mostly faculty/staff.
- That the AI knows parking rules on its own: it only phrases results from the app's tools, and rejects answers with invented numbers.
- That every lot's permit is known: 66 of 85 lots have no known class and are shown as "check the sign".
- Genie or a live Model Serving endpoint (neither is built; the forecast is batch-scored).

## Known limits to mention if asked
Lot capacities are derived from GIS polygon area (no published counts); the model list is configurable; the advisor is rate-limited (per visitor and per day) and falls back to the built-in assistant; the basemap and advisor need internet.
