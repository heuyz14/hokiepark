-- HokiePark: per-level garage occupancy (demo feed).
-- Browsers may only READ this table (anon key + RLS). Writes happen from the SQL editor / pg_cron / the
-- service role, never from the client. The service-role key must never be placed in the browser bundle.

create table if not exists public.garage_levels (
  garage_id    text        not null check (garage_id ~ '^[a-z0-9-]{1,64}$'),
  level_index  smallint    not null check (level_index between 0 and 99),
  label        text        not null check (char_length(label) between 1 and 80),
  capacity     integer     not null check (capacity between 1 and 5000),   -- includes the ADA spaces
  occupied     integer     not null,
  ada_capacity integer     not null default 0,
  ada_occupied integer     not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (garage_id, level_index),
  -- the same invariants the app enforces when it parses a response
  constraint occupied_in_range      check (occupied between 0 and capacity),
  constraint ada_capacity_in_range  check (ada_capacity between 0 and capacity),
  constraint ada_occupied_in_range  check (ada_occupied between 0 and ada_capacity and ada_occupied <= occupied)
);

comment on table public.garage_levels is 'Simulated per-level garage occupancy for the HokiePark demo (not real sensor data).';

create or replace function public.set_garage_levels_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists garage_levels_set_updated_at on public.garage_levels;
create trigger garage_levels_set_updated_at
  before update on public.garage_levels
  for each row execute function public.set_garage_levels_updated_at();

-- Row Level Security: public read-only.
alter table public.garage_levels enable row level security;

drop policy if exists "garage_levels are publicly readable" on public.garage_levels;
create policy "garage_levels are publicly readable"
  on public.garage_levels for select
  to anon, authenticated
  using (true);

-- Defense in depth: even if a write policy were added by mistake, the API roles hold no write privileges.
revoke all on public.garage_levels from anon, authenticated;
grant select on public.garage_levels to anon, authenticated;

-- Demo simulator: one random-walk step for every level. Keeps every invariant. Not callable by API roles.
create or replace function public.simulate_occupancy_tick() returns void
language plpgsql as $$
begin
  -- occupied moves by -3..+3 but never below the ADA spaces already taken, never above capacity
  update public.garage_levels
     set occupied = greatest(ada_occupied, least(capacity, occupied + (floor(random() * 7)::int - 3)));
  -- ADA moves by -1..+1 within its own capacity and never above total occupied
  update public.garage_levels
     set ada_occupied = greatest(0, least(ada_capacity, occupied, ada_occupied + (floor(random() * 3)::int - 1)));
end;
$$;

revoke all on function public.simulate_occupancy_tick() from public, anon, authenticated;
