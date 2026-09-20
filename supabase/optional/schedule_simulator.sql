-- OPTIONAL: make the demo feel live by nudging every level every minute.
-- 1) Dashboard -> Database -> Extensions -> enable "pg_cron".  2) Run this file in the SQL editor.
-- Re-running replaces the job of the same name, so this also changes an older schedule (for example the earlier every-5-minutes one).
-- To stop it: select cron.unschedule('hokiepark-simulate');
-- STALE_DATA_MS (12 min, src/lib/sync-label.ts) must stay at least twice the interval, or the header chip warns "Data Nm ago" between
-- ticks: 1, 5 or 10 minutes are fine, 15 is not. Each tick moves a level at most ~8% of its capacity, so a faster cron looks livelier.
-- To check it is running:  select jobname, schedule, active from cron.job;   and   select status, start_time from cron.job_run_details order by start_time desc limit 5;
select cron.schedule('hokiepark-simulate', '* * * * *', $$select public.simulate_occupancy_tick()$$);
-- other cadences:  '*/5 * * * *' (every 5 min), '*/10 * * * *' (every 10 min)

-- No cron? Press this in the SQL editor whenever you want the numbers to move during the demo:
--   select public.simulate_occupancy_tick();
-- Or set an exact scenario, e.g. make Perry Street level 2 nearly full:
--   update public.garage_levels set occupied = capacity - 3 where garage_id = 'perry-street' and level_index = 1;

-- Class-timetable-shaped mode (needs migration 20260919120000 + supabase/curves.seed.sql): the same tick now steers toward the
-- curve for the current weekday and time. To rehearse a busy moment without waiting for it:
--   update public.sim_config set clock_override = '10:30';    -- then run the tick ~15 times (waiting for the cron alone would take a while)
--   update public.sim_config set clock_override = null;       -- back to the real clock
