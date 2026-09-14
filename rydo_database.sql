-- =========================================================
-- RYDO V1 DATABASE
-- Supabase PostgreSQL
-- =========================================================

create extension if not exists pgcrypto;

-- =========================================================
-- PROFILES
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'passenger'
    check (role in ('passenger', 'driver', 'admin')),
  is_online boolean not null default false,
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================================================
-- VEHICLES
-- =========================================================

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  vehicle_type text not null
    check (vehicle_type in ('Bike', 'Car', 'Tuk Tuk')),
  vehicle_number text not null,
  model text not null,
  is_approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================================================
-- FARE SETTINGS
-- =========================================================

create table if not exists public.fare_settings (
  id uuid primary key default gen_random_uuid(),
  vehicle_type text not null unique
    check (vehicle_type in ('Bike', 'Car', 'Tuk Tuk')),
  base_fare numeric(10,2) not null default 0,
  per_km numeric(10,2) not null default 0,
  minimum_fare numeric(10,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- =========================================================
-- COMMISSION SETTINGS
-- =========================================================

create table if not exists public.commission_settings (
  id integer primary key default 1,
  commission_percent numeric(5,2) not null default 15,
  updated_at timestamptz not null default now(),
  constraint one_commission_row check (id = 1)
);

-- =========================================================
-- RIDES
-- =========================================================

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),

  passenger_id uuid not null
    references public.profiles(id) on delete cascade,

  driver_id uuid
    references public.profiles(id) on delete set null,

  pickup_location text not null,
  destination text not null,

  pickup_latitude double precision,
  pickup_longitude double precision,

  destination_latitude double precision,
  destination_longitude double precision,

  vehicle_type text not null
    check (vehicle_type in ('Bike', 'Car', 'Tuk Tuk')),

  distance_km numeric(10,2),
  duration_minutes numeric(10,2),

  fare numeric(10,2) not null default 0,

  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'online')),

  payment_status text not null default 'pending'
    check (
      payment_status in (
        'pending',
        'paid',
        'failed',
        'cancelled'
      )
    ),

  status text not null default 'requested'
    check (
      status in (
        'requested',
        'accepted',
        'started',
        'completed',
        'cancelled'
      )
    ),

  driver_earnings numeric(10,2) not null default 0,
  admin_earnings numeric(10,2) not null default 0,

  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  cancellation_reason text,

  passenger_rating integer
    check (
      passenger_rating is null
      or passenger_rating between 1 and 5
    ),

  passenger_review text,

  driver_rating integer
    check (
      driver_rating is null
      or driver_rating between 1 and 5
    ),

  driver_review text
);

-- =========================================================
-- DRIVER LIVE LOCATION
-- =========================================================

create table if not exists public.driver_locations (
  driver_id uuid primary key
    references public.profiles(id) on delete cascade,

  latitude double precision not null,
  longitude double precision not null,

  accuracy double precision,
  heading double precision,
  speed double precision,

  updated_at timestamptz not null default now()
);

-- =========================================================
-- SOS EVENTS
-- =========================================================

create table if not exists public.sos_events (
  id uuid primary key default gen_random_uuid(),

  passenger_id uuid
    references public.profiles(id) on delete cascade,

  driver_id uuid
    references public.profiles(id) on delete set null,

  ride_id uuid
    references public.rides(id) on delete set null,

  latitude double precision,
  longitude double precision,

  message text,

  status text not null default 'active'
    check (
      status in ('active', 'resolved')
    ),

  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- =========================================================
-- INDEXES
-- =========================================================

create index if not exists rides_passenger_idx
on public.rides(passenger_id);

create index if not exists rides_driver_idx
on public.rides(driver_id);

create index if not exists rides_status_idx
on public.rides(status);

create index if not exists rides_created_idx
on public.rides(created_at desc);

create index if not exists vehicles_driver_idx
on public.vehicles(driver_id);

create index if not exists driver_locations_updated_idx
on public.driver_locations(updated_at desc);

create index if not exists sos_events_ride_idx
on public.sos_events(ride_id);

-- =========================================================
-- DEFAULT FARE SETTINGS
-- =========================================================

insert into public.fare_settings
  (vehicle_type, base_fare, per_km, minimum_fare)
values
  ('Bike', 25, 14, 25),
  ('Car', 60, 25, 60),
  ('Tuk Tuk', 45, 18, 45)
on conflict (vehicle_type)
do update set
  base_fare = excluded.base_fare,
  per_km = excluded.per_km,
  minimum_fare = excluded.minimum_fare,
  updated_at = now();

-- =========================================================
-- DEFAULT COMMISSION
-- =========================================================

insert into public.commission_settings
  (id, commission_percent)
values
  (1, 15)
on conflict (id)
do update set
  commission_percent = excluded.commission_percent,
  updated_at = now();

-- =========================================================
-- ENABLE RLS
-- =========================================================

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.fare_settings enable row level security;
alter table public.commission_settings enable row level security;
alter table public.rides enable row level security;
alter table public.driver_locations enable row level security;
alter table public.sos_events enable row level security;

-- =========================================================
-- DROP OLD RYDO POLICIES
-- =========================================================

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

drop policy if exists "vehicles_select_own" on public.vehicles;
drop policy if exists "vehicles_insert_own" on public.vehicles;
drop policy if exists "vehicles_update_own" on public.vehicles;

drop policy if exists "fare_settings_read" on public.fare_settings;

drop policy if exists "commission_settings_read"
on public.commission_settings;

drop policy if exists "rides_passenger_insert"
on public.rides;

drop policy if exists "rides_passenger_select"
on public.rides;

drop policy if exists "rides_passenger_update"
on public.rides;

drop policy if exists "rides_driver_select"
on public.rides;

drop policy if exists "rides_driver_update"
on public.rides;

drop policy if exists "driver_locations_select_own"
on public.driver_locations;

drop policy if exists "driver_locations_insert_own"
on public.driver_locations;

drop policy if exists "driver_locations_update_own"
on public.driver_locations;

drop policy if exists "sos_passenger_insert"
on public.sos_events;

drop policy if exists "sos_passenger_select"
on public.sos_events;

-- =========================================================
-- PROFILES POLICIES
-- =========================================================

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
)
with check (
  id = auth.uid()
);

-- =========================================================
-- VEHICLE POLICIES
-- =========================================================

create policy "vehicles_select_own"
on public.vehicles
for select
to authenticated
using (
  driver_id = auth.uid()
);

create policy "vehicles_insert_own"
on public.vehicles
for insert
to authenticated
with check (
  driver_id = auth.uid()
);

create policy "vehicles_update_own"
on public.vehicles
for update
to authenticated
using (
  driver_id = auth.uid()
)
with check (
  driver_id = auth.uid()
);

-- =========================================================
-- FARE SETTINGS
-- =========================================================

create policy "fare_settings_read"
on public.fare_settings
for select
to authenticated
using (true);

-- =========================================================
-- COMMISSION SETTINGS
-- =========================================================

create policy "commission_settings_read"
on public.commission_settings
for select
to authenticated
using (true);

-- =========================================================
-- PASSENGER RIDE POLICIES
-- =========================================================

create policy "rides_passenger_insert"
on public.rides
for insert
to authenticated
with check (
  passenger_id = auth.uid()
);

create policy "rides_passenger_select"
on public.rides
for select
to authenticated
using (
  passenger_id = auth.uid()
);

create policy "rides_passenger_update"
on public.rides
for update
to authenticated
using (
  passenger_id = auth.uid()
)
with check (
  passenger_id = auth.uid()
);

-- =========================================================
-- DRIVER RIDE POLICIES
-- =========================================================

create policy "rides_driver_select"
on public.rides
for select
to authenticated
using (
  driver_id = auth.uid()
  or
  (
    status = 'requested'
    and driver_id is null
  )
);

create policy "rides_driver_update"
on public.rides
for update
to authenticated
using (
  driver_id = auth.uid()
  or
  (
    status = 'requested'
    and driver_id is null
  )
)
with check (
  driver_id = auth.uid()
);

-- =========================================================
-- DRIVER LOCATION POLICIES
-- =========================================================

create policy "driver_locations_select_own"
on public.driver_locations
for select
to authenticated
using (
  driver_id = auth.uid()
);

create policy "driver_locations_insert_own"
on public.driver_locations
for insert
to authenticated
with check (
  driver_id = auth.uid()
);

create policy "driver_locations_update_own"
on public.driver_locations
for update
to authenticated
using (
  driver_id = auth.uid()
)
with check (
  driver_id = auth.uid()
);

-- =========================================================
-- SOS POLICIES
-- =========================================================

create policy "sos_passenger_insert"
on public.sos_events
for insert
to authenticated
with check (
  passenger_id = auth.uid()
);

create policy "sos_passenger_select"
on public.sos_events
for select
to authenticated
using (
  passenger_id = auth.uid()
);

-- =========================================================
-- REALTIME
-- =========================================================

do $$
begin

  begin
    alter publication supabase_realtime
      add table public.rides;
  exception
    when duplicate_object then
      null;
  end;

  begin
    alter publication supabase_realtime
      add table public.driver_locations;
  exception
    when duplicate_object then
      null;
  end;

end $$;

-- =========================================================
-- FINISHED
-- =========================================================
