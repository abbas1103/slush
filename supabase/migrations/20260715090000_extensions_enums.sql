-- ─────────────────────────────────────────────────────────────────────────
-- Extensions + enums
-- Money is integer pence everywhere. All fixed vocabularies are native enums
-- so the database enforces them and Supabase type-gen picks them up.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;      -- case-insensitive email + trip code

-- Trip lifecycle
create type trip_status as enum ('draft', 'live', 'closed');

-- Extra categories
create type extra_type as enum ('transport', 'equipment', 'lessons', 'event', 'other');

-- Booking lifecycle.
--   pending    → row exists during checkout, before payment succeeds
--   confirmed  → paid and within capacity
--   waitlisted → paid but trip was full at payment (still paid £150)
--   converted  → a waitlister promoted by admin (treated as confirmed)
--   cancelled  → abandoned/expired pre-payment, or user cancellation
--   refunded   → money returned (normal or full-£150 waitlist refund)
-- NOTE: 'pending' is added beyond the brief's list - a not-yet-paid booking
-- needs a non-terminal state; the capacity decision flips it at payment.
create type booking_status as enum (
  'pending', 'confirmed', 'waitlisted', 'converted', 'cancelled', 'refunded'
);

-- Payment ledger entry types (a single Stripe charge can produce two rows:
-- e.g. a £150 deposit = one 'deposit' £50 + one 'damage_deposit_hold' £100).
create type payment_type as enum (
  'deposit', 'balance', 'damage_deposit_hold', 'damage_deposit_refund', 'waitlist_refund'
);

create type payment_status as enum (
  'pending', 'processing', 'succeeded', 'failed', 'canceled', 'refunded'
);

-- Damage-deposit lifecycle (charge-then-refund model)
create type damage_status as enum ('held', 'refunded', 'withheld');

-- 30-minute hold lifecycle
create type hold_status as enum ('active', 'consumed', 'released', 'expired');
