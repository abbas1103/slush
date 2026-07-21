-- ─────────────────────────────────────────────────────────────────────────
-- Financial tables. These are written ONLY from the verified Stripe webhook
-- (service-role client) - never from client callbacks. `payments` is an
-- append-only ledger that reconciles 1:1 to Stripe per payment intent.
-- ─────────────────────────────────────────────────────────────────────────

create table payments (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references bookings(id),
  stripe_payment_intent_id text,
  stripe_charge_id         text,
  stripe_refund_id         text,
  type                     payment_type not null,
  amount                   integer not null,          -- pence, always positive; type implies direction
  currency                 text not null default 'gbp',
  status                   payment_status not null default 'pending',
  created_at               timestamptz not null default now(),
  constraint payments_amount_chk check (amount >= 0)
);
create index payments_booking_idx on payments(booking_id);
create index payments_intent_idx  on payments(stripe_payment_intent_id);
-- one ledger row per (intent, type) - the webhook write-idempotency guard.
-- A £150 deposit intent yields exactly one 'deposit' + one 'damage_deposit_hold'.
create unique index payments_intent_type_uidx
  on payments(stripe_payment_intent_id, type)
  where stripe_payment_intent_id is not null;

-- Damage-deposit state machine (the £100 is genuinely captured up front and
-- refunded after the trip; a Stripe auth hold can't span months to trip-end).
create table damage_deposits (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references bookings(id),
  amount                   integer not null default 10000,
  status                   damage_status not null default 'held',
  stripe_payment_intent_id text,
  stripe_refund_id         text,
  withheld_amount          integer not null default 0,
  refunded_at              timestamptz,
  created_at               timestamptz not null default now(),
  constraint damage_amount_chk   check (amount >= 0),
  constraint damage_withheld_chk check (withheld_amount >= 0 and withheld_amount <= amount)
);
create unique index damage_deposits_one_live_per_booking
  on damage_deposits(booking_id) where status <> 'refunded';
create index damage_deposits_booking_idx on damage_deposits(booking_id);

-- Inbound Stripe webhook idempotency: insert ON CONFLICT DO NOTHING at the top
-- of the handler; if the event id already exists it's a duplicate → ack and stop.
create table stripe_events (
  id          text primary key,              -- Stripe event.id
  type        text not null,
  payload     jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
