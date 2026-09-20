-- OPTIONAL: make the demo feel live by nudging every level every 5 minutes.
-- 1) Dashboard -> Database -> Extensions -> enable "pg_cron".  2) Run this file in the SQL editor.
-- Re-running replaces the job of the same name, so this also upgrades an older every-minute schedule.
-- To stop it: select cron.unschedule('hokiepark-simulate');
-- Keep this in step with STALE_DATA_MS (12 min) in src/lib/sync-label.ts: the header chip warns "Data Nm ago" only after
-- two missed 5-minute ticks. To check it is running:  select jobname, schedule, active from cron.job;
select cron.schedule('hokiepark-simulate', '*/5 * * * *', $$select public.simulate_occupancy_tick()$$);

-- No cron? Press this in the SQL editor whenever you want the numbers to move during the demo:
--   select public.simulate_occupancy_tick();
-- Or set an exact scenario, e.g. make Perry Street level 2 nearly full:
--   update public.garage_levels set occupied = capacity - 3 where garage_id = 'perry-street' and level_index = 1;

-- Class-timetable-shaped mode (needs migration 20260919120000 + supabase/curves.seed.sql): the same tick now steers toward the
-- curve for the current weekday and time. To rehearse a busy moment without waiting for it:
--   update public.sim_config set clock_override = '10:30';    -- then run the tick ~15 times (waiting for the 5-minute cron would take over an hour)
--   update public.sim_config set clock_override = null;       -- back to the real clock
