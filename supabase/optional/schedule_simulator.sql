-- OPTIONAL: make the demo feel live by nudging every level once a minute.
-- 1) Dashboard -> Database -> Extensions -> enable "pg_cron".  2) Run this file in the SQL editor.
-- To stop it: select cron.unschedule('hokiepark-simulate');
select cron.schedule('hokiepark-simulate', '* * * * *', $$select public.simulate_occupancy_tick()$$);

-- No cron? Press this in the SQL editor whenever you want the numbers to move during the demo:
--   select public.simulate_occupancy_tick();
-- Or set an exact scenario, e.g. make Perry Street level 2 nearly full:
--   update public.garage_levels set occupied = capacity - 3 where garage_id = 'perry-street' and level_index = 1;
