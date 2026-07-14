-- ─────────────────────────────────────────────────────────────────────────
-- Booking tables: the booking itself, its snapshotted extras, and the
-- server-side 30-minute holds that gate entry to checkout.
-- ─────────────────────────────────────────────────────────────────────────

create table bookings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id),
  trip_id           uuid not null references trips(id),
  trip_code_id      uuid references trip_codes(id),
  reference         text not null unique,          -- e.g. BRUM-26-0481 (minted server-side)
  status            booking_status not null default 'pending',
  insurance_choice  text check (insurance_choice in ('own', 'bought')),
  insurance_details jsonb,                          -- policy fields encrypted at app layer
  access_needs      text,                           -- special-category; app-layer encrypted
  created_at        timestamptz not null default now()
);
-- one live booking per student per trip (pending counts as live; abandoned
-- pendings are swept to 'cancelled', freeing a retry)
create unique index bookings_one_live_per_user_trip
  on bookings(user_id, trip_id)
  where status not in ('cancelled', 'refunded');
create index bookings_trip_status_idx on bookings(trip_id, status);
create index bookings_user_idx on bookings(user_id);

create table booking_extras (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references bookings(id) on delete cascade,
  extra_id         uuid not null references extras(id),
  extra_tier_id    uuid references extra_tiers(id),
  quantity         integer not null default 1,
  price_at_booking integer not null,               -- per-unit pence snapshot at selection time
  created_at       timestamptz not null default now(),
  constraint booking_extras_qty_chk   check (quantity > 0),
  constraint booking_extras_price_chk check (price_at_booking >= 0)
);
create index booking_extras_booking_idx on booking_extras(booking_id);

-- A hold reserves a place for 30 minutes while the student builds/pays their
-- booking. expires_at is the server truth; the UI countdown derives from it.
-- Capacity reads count active, unexpired holds (see trip_availability view).
create table holds (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  booking_id  uuid references bookings(id) on delete set null,
  status      hold_status not null default 'active',
  is_waitlist boolean not null default false,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
-- at most one active hold per student per trip
create unique index holds_one_active_per_user_trip
  on holds(trip_id, user_id) where status = 'active';
create index holds_trip_status_expiry_idx on holds(trip_id, status, expires_at);
