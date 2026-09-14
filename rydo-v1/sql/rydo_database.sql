-- ============================================================
-- RYDO V1 DATABASE
-- Passenger + Driver + Admin foundation
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- PROFILES
-- ============================================================

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

-- ============================================================
-- VEHICLES
-- ============================================================

create table if not exists public.vehicles (
    id uuid primary key default gen_random_uuid(),
    driver_id uuid not null references public.profiles(id) on delete cascade,
    vehicle_type text not null
        check (vehicle_type in ('Bike', 'Car', 'Tuk Tuk')),
    vehicle_number text not null,
    model text,
    is_approved boolean not null default false,
    created_at timestamptz not null default now()
);

-- ============================================================
-- FARE SETTINGS
-- Admin controls these values.
-- ============================================================

create table if not exists public.fare_settings (
    id uuid primary key default gen_random_uuid(),
    vehicle_type text unique not null
        check (vehicle_type in ('Bike', 'Car', 'Tuk Tuk')),
    base_fare numeric(10,2) not null default 0,
    per_km numeric(10,2) not null default 0,
    minimum_fare numeric(10,2) not null default 0,
    updated_at timestamptz not null default now()
);

-- Default starting values.
-- Admin can change them later.

insert into public.fare_settings
    (vehicle_type, base_fare, per_km, minimum_fare)
values
    ('Bike', 25, 14, 25),
    ('Car', 60, 25, 60),
    ('Tuk Tuk', 45, 18, 45)
on conflict (vehicle_type) do nothing;

-- ============================================================
-- COMMISSION SETTINGS
-- ============================================================

create table if not exists public.commission_settings (
    id uuid primary key default gen_random_uuid(),
    commission_percent numeric(5,2) not null default 15,
    updated_at timestamptz not null default now()
);

insert into public.commission_settings
    (commission_percent)
select 15
where not exists (
    select 1 from public.commission_settings
);

-- ============================================================
-- RIDES
-- ============================================================

create table if not exists public.rides (
    id uuid primary key default gen_random_uuid(),

    passenger_id uuid not null
        references public.profiles(id) on delete cascade,

    driver_id uuid
        references public.profiles(id) on delete set null,

    pickup_location text not null,
    destination text not null,

    pickup_lat numeric(10,7),
    pickup_lng numeric(10,7),
    destination_lat numeric(10,7),
    destination_lng numeric(10,7),

    vehicle_type text not null
        check (vehicle_type in ('Bike', 'Car', 'Tuk Tuk')),

    distance_km numeric(10,2),
    fare numeric(10,2) not null default 0,

    driver_earnings numeric(10,2) default 0,
    admin_earnings numeric(10,2) default 0,

    payment_method text not null default 'Cash'
        check (payment_method in ('Cash', 'Online')),

    payment_status text not null default 'pending'
        check (
            payment_status in
            ('pending', 'paid', 'failed', 'refunded')
        ),

    status text not null default 'requested'
        check (
            status in (
                'requested',
                'accepted',
                'arrived',
                'started',
                'completed',
                'cancelled'
            )
        ),

    cancellation_reason text,

    accepted_at timestamptz,
    arrived_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,

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

    driver_review text,

    created_at timestamptz not null default now()
);

-- ============================================================
-- DRIVER LIVE LOCATION
-- Driver phone can update this while online/on a ride.
-- ============================================================

create table if not exists public.driver_locations (
    driver_id uuid primary key
        references public.profiles(id) on delete cascade,

    latitude numeric(10,7) not null,
    longitude numeric(10,7) not null,

    heading numeric(6,2),
    speed numeric(8,2),

    updated_at timestamptz not null default now()
);

-- ============================================================
-- SOS EVENTS
-- ============================================================

create table if not exists public.sos_events (
    id uuid primary key default gen_random_uuid(),

    passenger_id uuid
        references public.profiles(id) on delete set null,

    ride_id uuid
        references public.rides(id) on delete set null,

    latitude numeric(10,7),
    longitude numeric(10,7),

    message text,

    created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists rides_passenger_id_idx
on public.rides(passenger_id);

create index if not exists rides_driver_id_idx
on public.rides(driver_id);

create index if not exists rides_status_idx
on public.rides(status);

create index if not exists rides_created_at_idx
on public.rides(created_at desc);

create index if not exists vehicles_driver_id_idx
on public.vehicles(driver_id);

create index if not exists driver_locations_updated_at_idx
on public.driver_locations(updated_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.fare_settings enable row level security;
alter table public.commission_settings enable row level security;
alter table public.rides enable row level security;
alter table public.driver_locations enable row level security;
alter table public.sos_events enable row level security;

-- ============================================================
-- PROFILES POLICIES
-- ============================================================

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- ============================================================
-- VEHICLE POLICIES
-- ============================================================

drop policy if exists "vehicles_driver_select" on public.vehicles;
create policy "vehicles_driver_select"
on public.vehicles
for select
to authenticated
using ((select auth.uid()) = driver_id);

drop policy if exists "vehicles_driver_insert" on public.vehicles;
create policy "vehicles_driver_insert"
on public.vehicles
for insert
to authenticated
with check ((select auth.uid()) = driver_id);

drop policy if exists "vehicles_driver_update" on public.vehicles;
create policy "vehicles_driver_update"
on public.vehicles
for update
to authenticated
using ((select auth.uid()) = driver_id)
with check ((select auth.uid()) = driver_id);

-- ============================================================
-- FARE SETTINGS
-- Passenger can read fare settings.
-- Only admin should change them.
-- ============================================================

drop policy if exists "fare_settings_authenticated_read"
on public.fare_settings;

create policy "fare_settings_authenticated_read"
on public.fare_settings
for select
to authenticated
using (true);

-- ============================================================
-- COMMISSION SETTINGS
-- ============================================================

drop policy if exists "commission_settings_authenticated_read"
on public.commission_settings;

create policy "commission_settings_authenticated_read"
on public.commission_settings
for select
to authenticated
using (true);

-- ============================================================
-- RIDE POLICIES
-- ============================================================

drop policy if exists "rides_passenger_select"
on public.rides;

create policy "rides_passenger_select"
on public.rides
for select
to authenticated
using (
    (select auth.uid()) = passenger_id
    or
    (select auth.uid()) = driver_id
);

drop policy if exists "rides_passenger_insert"
on public.rides;

create policy "rides_passenger_insert"
on public.rides
for insert
to authenticated
with check (
    (select auth.uid()) = passenger_id
);

drop policy if exists "rides_passenger_update"
on public.rides;

create policy "rides_passenger_update"
on public.rides
for update
to authenticated
using (
    (select auth.uid()) = passenger_id
)
with check (
    (select auth.uid()) = passenger_id
);

-- ============================================================
-- DRIVER LOCATION POLICIES
-- ============================================================

drop policy if exists "driver_location_own_select"
on public.driver_locations;

create policy "driver_location_own_select"
on public.driver_locations
for select
to authenticated
using (
    (select auth.uid()) = driver_id
);

drop policy if exists "driver_location_own_insert"
on public.driver_locations;

create policy "driver_location_own_insert"
on public.driver_locations
for insert
to authenticated
with check (
    (select auth.uid()) = driver_id
);

drop policy if exists "driver_location_own_update"
on public.driver_locations;

create policy "driver_location_own_update"
on public.driver_locations
for update
to authenticated
using (
    (select auth.uid()) = driver_id
)
with check (
    (select auth.uid()) = driver_id
);

-- ============================================================
-- SOS POLICIES
-- ============================================================

drop policy if exists "sos_passenger_insert"
on public.sos_events;

create policy "sos_passenger_insert"
on public.sos_events
for insert
to authenticated
with check (
    (select auth.uid()) = passenger_id
);

drop policy if exists "sos_passenger_select"
on public.sos_events;

create policy "sos_passenger_select"
on public.sos_events
for select
to authenticated
using (
    (select auth.uid()) = passenger_id
);

-- ============================================================
-- REALTIME
-- ============================================================

alter table public.rides replica identity full;
alter table public.driver_locations replica identity full;

-- Add realtime publication entries only if they aren't already there.
do $$
begin
    begin
        alter publication supabase_realtime
        add table public.rides;
    exception
        when duplicate_object then null;
    end;

    begin
        alter publication supabase_realtime
        add table public.driver_locations;
    exception
        when duplicate_object then null;
    end;
end
$$;

-- ============================================================
-- DONE
-- ============================================================
