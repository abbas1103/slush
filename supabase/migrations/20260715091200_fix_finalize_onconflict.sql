-- ─────────────────────────────────────────────────────────────────────────
-- Fix: the payments unique index is PARTIAL
--   (stripe_payment_intent_id, type) WHERE stripe_payment_intent_id IS NOT NULL
-- so ON CONFLICT must repeat that predicate to match it as an arbiter,
-- otherwise Postgres raises 42P10. Redefine record_payment_and_finalize with
-- the predicate on each payments upsert.
-- ─────────────────────────────────────────────────────────────────────────

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
  v_trip_cost int;
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
    if v_status = 'pending' then
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
      insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
        values (p_booking_id, p_intent_id, p_charge_id, 'deposit', v_downpay, 'succeeded')
        on conflict (stripe_payment_intent_id, type) where stripe_payment_intent_id is not null do nothing;
    else
      v_trip_cost := public.compute_trip_cost(p_booking_id);
      insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
        values (p_booking_id, p_intent_id, p_charge_id, 'deposit', v_trip_cost, 'succeeded')
        on conflict (stripe_payment_intent_id, type) where stripe_payment_intent_id is not null do nothing;
    end if;

    insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
      values (p_booking_id, p_intent_id, p_charge_id, 'damage_deposit_hold', v_damage, 'succeeded')
      on conflict (stripe_payment_intent_id, type) where stripe_payment_intent_id is not null do nothing;
    insert into public.damage_deposits (booking_id, amount, status, stripe_payment_intent_id)
      values (p_booking_id, v_damage, 'held', p_intent_id)
      on conflict do nothing;

    update public.holds set status = 'consumed'
     where booking_id = p_booking_id and status = 'active';

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
