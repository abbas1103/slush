-- ─────────────────────────────────────────────────────────────────────────
-- Core catalogue tables: trips, trip codes, extras, extra tiers, and the
-- student profile mirror of auth.users + emergency contacts.
-- Everything the admin edits (prices, capacity, inclusions, codes) is data here.
-- ─────────────────────────────────────────────────────────────────────────

create table trips (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  organiser             text not null,                 -- e.g. "Brumski"
  resort                text not null,
  country               text not null,
  start_date            date not null,
  end_date              date not null,
  nights                integer not null,
  base_price            integer not null,              -- pence
  base_inclusions       jsonb not null default '[]'::jsonb,  -- array of strings
  deposit_amount        integer not null default 15000,
  downpayment_amount    integer not null default 5000, -- trip-applied part of the deposit
  damage_deposit_amount integer not null default 10000,
  balance_due_date      date,
  capacity              integer not null default 300,
  confirmed_count       integer not null default 0,    -- denormalised; only the capacity-lock fns write it
  description           text,
  status                trip_status not null default 'draft',
  created_at            timestamptz not null default now(),
  constraint trips_dates_chk           check (end_date >= start_date),
  constraint trips_nights_chk          check (nights > 0),
  constraint trips_base_price_chk      check (base_price >= 0),
  constraint trips_capacity_chk        check (capacity >= 0),
  constraint trips_confirmed_count_chk check (confirmed_count >= 0),
  -- keep the deposit split coherent when an admin edits the amounts
  constraint trips_deposit_split_chk   check (downpayment_amount + damage_deposit_amount = deposit_amount)
);

create table trip_codes (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  code       citext not null unique,        -- case-insensitive; high-entropy, not sequential
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index trip_codes_trip_id_idx on trip_codes(trip_id);

create table extras (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references trips(id) on delete cascade,
  type                extra_type not null,
  name                text not null,
  description         text,
  price               integer,               -- pence; null when TBC or tier-priced
  price_tbc           boolean not null default false,
  has_quality_tiers   boolean not null default false,
  single_select_group text,                  -- e.g. 'equipment_rental' → mutually exclusive
  sort_order          integer not null default 0,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  -- a bookable extra must have a price unless it is TBC or priced via tiers
  constraint extras_price_chk     check (price_tbc or has_quality_tiers or price is not null),
  -- a TBC extra must not carry a price
  constraint extras_tbc_null_chk  check (not price_tbc or price is null),
  constraint extras_price_pos_chk check (price is null or price >= 0)
);
create index extras_trip_sort_idx on extras(trip_id, sort_order);

create table extra_tiers (
  id         uuid primary key default gen_random_uuid(),
  extra_id   uuid not null references extras(id) on delete cascade,
  name       text not null,                  -- Economy / Evolution / Performance / Excellence
  price      integer not null,               -- pence
  sort_order integer not null default 0,
  constraint extra_tiers_price_chk check (price >= 0),
  unique (extra_id, name)
);

-- Student profile: a 1:1 mirror of auth.users, populated by a trigger on signup
-- (added in the triggers migration). Sensitive fields (passport, insurer policy,
-- access needs) are stored as app-layer AES-256-GCM ciphertext, never plaintext.
create table users (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               citext not null,
  first_name          text,
  last_name           text,
  title               text,
  dob                 date,
  nationality         text,
  passport_number     text,                  -- ciphertext: 'v1:<iv>:<ct+tag>'
  phone               text,
  home_address        jsonb,
  university_society  text,
  student_id          text,
  created_at          timestamptz not null default now()
);

create table emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  full_name    text not null,
  relationship text,
  phone        text not null,
  created_at   timestamptz not null default now()
);
create index emergency_contacts_user_idx on emergency_contacts(user_id);
