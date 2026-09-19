# HokiePark demo runbook

Numbers below are the simulator's targets for **Wednesday** (the weekend replay day) from `supabase/curves.seed.sql`.
They are SIMULATED, shaped by VT's class timetable (seat capacity, not enrollment) plus an assumed staff workday.
Say that out loud in the demo. Counts move toward the target by at most ~8% of a level per tick, so allow ~15 ticks
(or ~15 minutes of pg_cron) for a big swing.

## Before you present (10 min)
1. `npm run check:supabase` -> 4 PASS lines. `npm run build` -> `live feed: ON`.
2. Supabase SQL editor: `update public.sim_config set clock_override = null;` (real clock; weekends replay Wednesday).
3. Optional auto-movement: enable `pg_cron`, run `supabase/optional/schedule_simulator.sql` (ticks every minute).
   No cron? Run `select public.simulate_occupancy_tick();` before each part of the demo.
4. Open the deployed URL on the phone (chip should read `Live`). Keep `docs/fallback/` screenshots on the laptop.

## Moments to jump to
Set the clock, then tick ~15 times (paste the tick line 15x, or wait for cron):
```sql
update public.sim_config set clock_override = '08:50';
select public.simulate_occupancy_tick();
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

## Exact scenarios (independent of the curve)
```sql
-- make one level nearly full right now (the next tick will start pulling it back toward the curve)
update public.garage_levels set occupied = capacity - 3 where garage_id = 'perry-street' and level_index = 1;
```
To hold a scenario, set `clock_override` to a time whose target matches it, or pause pg_cron (`select cron.unschedule('hokiepark-simulate');`).

## The 60-90 second narration (honest version)
1. "Built from Virginia Tech's own public GIS data: 102 buildings, real lot and garage footprints."
2. "Garage counts are simulated, but shaped by VT's real class schedule: we pull the public Timetable of Classes, place ~420k weekly seats on buildings, and let seats in session near each garage drive its fill through the day."
3. Tap a garage: level breakdown, ADA spaces per level, permit filter dims what you can't use.
4. Ask the assistant: "Where can I park near Torgersen?" (same numbers as the map).
5. One sentence on Databricks: "In production this pipeline becomes a Delta pipeline in Unity Catalog with sensor data replacing the simulator, MLflow for forecasting once we have real history, Genie for the assistant."
6. Do NOT claim: real sensors, validated forecasts, or that class density measures garage demand. Both garages are mostly faculty/staff.

## If something breaks
| Symptom | Cause | Fix |
| --- | --- | --- |
| Chip says `Offline` | Network / Supabase outage | App keeps last counts; keep presenting, or show `docs/fallback/` screenshots |
| Chip says `Data 12m ago` | Nothing is ticking | Run the tick, or enable pg_cron |
| Counts look frozen after changing the clock | Tick moves ~8% per call | Run the tick ~15 times |
| Chip says `Sample data` | Build has no Supabase values | Set the two vars in `.env.local` (local) or GitHub Actions Variables (deployed) and rebuild |
| Everything is 95% full | Working as designed at peak | Jump to 07:30 or 20:00, or lower `peakFrac` in `src/lib/demand.ts` and run `npm run curves` |
