-- ─────────────────────────────────────────────────────────────────────────
-- Pre-go-live audit hardening (Slice 10 pt 3).
-- Fixes confirmed by the adversarial audit:
--   #1 pay-in-full underpayment (finalize recomputed cost instead of charge)
--   #3 payment landing after the hold-sweep cancels a booking → never placed
--   #9 double-charge: track the live deposit/full intent so only one exists
--   #10 clients could UPDATE their own users row directly, bypassing encryption
--   PII: dob now stored as AES-GCM ciphertext (column type date → text)
-- ─────────────────────────────────────────────────────────────────────────

-- ── #10: remove the direct client write path on users. All profile writes go
-- through saveDetails (service-role), which encrypts PII and runs the 18+ gate.
drop policy if exists users_update_own on public.users;
revoke update on public.users from authenticated;

-- ── PII: dob holds versioned AES-256-GCM ciphertext now, not a calendar date.
alter table public.users alter column dob type text using dob::text;

-- ── #9 enabler: the single live deposit/full PaymentIntent for a booking.
alter table public.bookings add column if not exists payment_intent_id text;

-- ── #1 + #3: correct record_payment_and_finalize.
create or replace function public.record_payment_and_finalize(
  p_booking_id   uuid,
  p_intent_id    text,
  p_charge_id    text,
  p_kind         text,
  p_amount_total integer
)
returns public.booking_status
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_trip      uuid;
  v_status    public.booking_status;
  v_capacity  int;
  v_confirmed int;
  v_downpay   int;
  v_damage    int;
  v_trip_paid int;
begin
  select b.trip_id, b.status
    into v_trip, v_status
    from public.bookings b
   where b.id = p_booking_id
   for update;
  if v_trip is null then raise exception 'booking not found'; end if;

  select t.capacity, t.confirmed_count, t.downpayment_amount, t.damage_deposit_amount
    into v_capacity, v_confirmed, v_downpay, v_damage
    from public.trips t where t.id = v_trip
   for update;

  if p_kind in ('deposit', 'full') then
    -- #3: also place a booking the cron swept to 'cancelled' after its hold
    -- expired - the customer paid, so they get a seat (or the waitlist).
    -- 'refunded' stays terminal and is never resurrected.
    if v_status in ('pending', 'cancelled') then
      if v_confirmed < v_capacity then
        update public.bookings set status = 'confirmed' where id = p_booking_id;
        update public.trips set confirmed_count = confirmed_count + 1 where id = v_trip;
        v_status := 'confirmed';
      else
        update public.bookings set status = 'waitlisted' where id = p_booking_id;
        v_status := 'waitlisted';
      end if;
    end if;

    if p_kind = 'deposit' then
      v_trip_paid := v_downpay;
    else
      -- #1: record the trip-money ACTUALLY captured (charge minus the damage
      -- hold), NOT a fresh compute_trip_cost(). Extras added after the intent
      -- was created then leave an owed balance instead of being credited free.
      v_trip_paid := p_amount_total - v_damage;
    end if;

    insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
      values (p_booking_id, p_intent_id, p_charge_id, 'deposit', v_trip_paid, 'succeeded')
      on conflict (stripe_payment_intent_id, type) where stripe_payment_intent_id is not null do nothing;

    insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
      values (p_booking_id, p_intent_id, p_charge_id, 'damage_deposit_hold', v_damage, 'succeeded')
      on conflict (stripe_payment_intent_id, type) where stripe_payment_intent_id is not null do nothing;
    insert into public.damage_deposits (booking_id, amount, status, stripe_payment_intent_id)
      values (p_booking_id, v_damage, 'held', p_intent_id)
      on conflict do nothing;

    update public.holds set status = 'consumed'
     where booking_id = p_booking_id and status = 'active';

    -- The live intent has been consumed; clear the guard so it can't be re-cancelled.
    update public.bookings set payment_intent_id = null where id = p_booking_id;

  elsif p_kind = 'balance' then
    insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
      values (p_booking_id, p_intent_id, p_charge_id, 'balance', p_amount_total, 'succeeded')
      on conflict (stripe_payment_intent_id, type) where stripe_payment_intent_id is not null do nothing;
  else
    raise exception 'unknown payment kind: %', p_kind;
  end if;

  return v_status;
end;
$$;

revoke execute on function public.record_payment_and_finalize(uuid, text, text, text, integer) from public;
grant execute on function public.record_payment_and_finalize(uuid, text, text, text, integer) to service_role;
