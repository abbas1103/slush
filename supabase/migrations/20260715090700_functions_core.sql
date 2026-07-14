-- ─────────────────────────────────────────────────────────────────────────
-- Core server-side logic: booking references, money math, trip-code redemption,
-- the 30-minute hold, and the atomic capacity decision at payment.
-- All are SECURITY DEFINER with an empty search_path. Execute privileges are
-- locked down at the bottom: client-callable RPCs go to `authenticated`;
-- money/capacity finalisation goes to `service_role` (webhook) ONLY.
-- ─────────────────────────────────────────────────────────────────────────

create sequence if not exists booking_ref_seq;

-- Reference like BRUM-26-0481: <organiser prefix>-<trip year>-<zero-padded seq>.
create or replace function public.generate_booking_reference(p_trip_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_year   text;
  v_ref    text;
begin
  select left(upper(regexp_replace(coalesce(t.organiser, t.name, 'SLUSH'), '[^a-zA-Z]', '', 'g')), 4),
         to_char(t.start_date, 'YY')
    into v_prefix, v_year
    from public.trips t
   where t.id = p_trip_id;

  v_prefix := coalesce(nullif(v_prefix, ''), 'SLUSH');

  loop
    v_ref := v_prefix || '-' || v_year || '-' || lpad(nextval('public.booking_ref_seq')::text, 4, '0');
    exit when not exists (select 1 from public.bookings where reference = v_ref);
  end loop;
  return v_ref;
end;
$$;

-- ── Money (server-authoritative) ────────────────────────────────────────────
-- Trip cost C = base_price + Σ(snapshotted extra price × quantity).
create or replace function public.compute_trip_cost(p_booking_id uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select
    (select t.base_price
       from public.bookings b join public.trips t on t.id = b.trip_id
      where b.id = p_booking_id)
    + coalesce((select sum(be.price_at_booking * be.quantity)
                  from public.booking_extras be
                 where be.booking_id = p_booking_id), 0);
$$;

-- Money actually received toward the trip: deposit downpayment + balance
-- payments, minus the trip-applied portion (£50) of any waitlist refund.
create or replace function public.booking_trip_paid(p_booking_id uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select
    coalesce((select sum(p.amount)
                from public.payments p
               where p.booking_id = p_booking_id
                 and p.status = 'succeeded'
                 and p.type in ('deposit', 'balance')), 0)
    - coalesce((select sum(least(p.amount, t.downpayment_amount))
                  from public.payments p
                  join public.bookings b on b.id = p.booking_id
                  join public.trips t on t.id = b.trip_id
                 where p.booking_id = p_booking_id
                   and p.type = 'waitlist_refund'
                   and p.status = 'succeeded'), 0);
$$;

-- Outstanding balance = C − trip paid.
create or replace function public.booking_balance(p_booking_id uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select public.compute_trip_cost(p_booking_id) - public.booking_trip_paid(p_booking_id);
$$;

-- ── Trip-code redemption (bypasses the no-public-read on trip_codes) ─────────
create or replace function public.redeem_trip_code(p_code text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select tc.trip_id
    from public.trip_codes tc
    join public.trips t on t.id = tc.trip_id
   where tc.code = p_code and tc.active and t.status = 'live'
   limit 1;
$$;

-- Is the trip effectively full (confirmed + live holds >= capacity)? Returns a
-- boolean only — never a remaining-places count.
create or replace function public.trip_effective_full(p_trip_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (t.confirmed_count
          + coalesce((select count(*) from public.holds h
                       where h.trip_id = t.id and h.status = 'active' and h.expires_at > now()), 0)
         ) >= t.capacity
    from public.trips t
   where t.id = p_trip_id;
$$;

-- ── 30-minute hold: start / release / sweep ─────────────────────────────────
-- Reserves a place (or a waitlist spot if full) and creates/reuses a pending
-- booking. Decides is_waitlist under the trip row lock; the AUTHORITATIVE
-- confirmed-vs-waitlisted decision is still made at payment (finalise below).
create or replace function public.start_booking(p_trip_code_id uuid)
returns table (booking_id uuid, is_waitlist boolean, expires_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user        uuid := auth.uid();
  v_trip        uuid;
  v_code_active boolean;
  v_trip_status public.trip_status;
  v_capacity    int;
  v_confirmed   int;
  v_other_holds int;
  v_waitlist    boolean;
  v_booking     uuid;
  v_ref         text;
  v_expires     timestamptz := now() + interval '30 minutes';
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select tc.trip_id, tc.active, t.status
    into v_trip, v_code_active, v_trip_status
    from public.trip_codes tc join public.trips t on t.id = tc.trip_id
   where tc.id = p_trip_code_id;

  if v_trip is null or not v_code_active or v_trip_status <> 'live' then
    raise exception 'invalid or inactive trip code';
  end if;

  -- lock the trip row: serialises capacity reads with finalise
  select t.capacity, t.confirmed_count
    into v_capacity, v_confirmed
    from public.trips t where t.id = v_trip for update;

  -- lazily expire stale holds so they stop counting
  update public.holds set status = 'expired'
   where trip_id = v_trip and status = 'active' and expires_at <= now();

  select count(*) into v_other_holds
    from public.holds
   where trip_id = v_trip and status = 'active' and expires_at > now()
     and user_id <> v_user;

  v_waitlist := (v_confirmed + v_other_holds) >= v_capacity;

  -- reuse a live booking for this user+trip if one exists, else create pending
  select id into v_booking
    from public.bookings
   where user_id = v_user and trip_id = v_trip
     and status not in ('cancelled', 'refunded')
   limit 1;

  if v_booking is null then
    v_ref := public.generate_booking_reference(v_trip);
    insert into public.bookings (user_id, trip_id, trip_code_id, reference, status)
      values (v_user, v_trip, p_trip_code_id, v_ref, 'pending')
      returning id into v_booking;
  end if;

  -- refresh the user's hold
  update public.holds set status = 'released'
   where trip_id = v_trip and user_id = v_user and status = 'active';
  insert into public.holds (trip_id, user_id, booking_id, status, is_waitlist, expires_at)
    values (v_trip, v_user, v_booking, 'active', v_waitlist, v_expires);

  return query select v_booking, v_waitlist, v_expires;
end;
$$;

create or replace function public.release_hold(p_booking_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  update public.holds set status = 'released'
   where booking_id = p_booking_id and user_id = v_user and status = 'active';
  update public.bookings set status = 'cancelled'
   where id = p_booking_id and user_id = v_user and status = 'pending';
end;
$$;

-- Cron sweep: expire stale holds and cancel abandoned pending bookings.
create or replace function public.expire_stale_holds()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_count int;
begin
  update public.holds set status = 'expired'
   where status = 'active' and expires_at <= now();
  get diagnostics v_count = row_count;

  update public.bookings b set status = 'cancelled'
   where b.status = 'pending'
     and not exists (select 1 from public.holds h
                      where h.booking_id = b.id and h.status = 'active' and h.expires_at > now())
     and not exists (select 1 from public.payments p
                      where p.booking_id = b.id and p.status = 'succeeded');
  return v_count;
end;
$$;

-- ── The capacity race: decide + write the ledger atomically at payment ──────
-- Called ONCE per successful payment from the verified Stripe webhook.
-- p_kind: 'deposit' | 'full' | 'balance'. Idempotent (safe on Stripe retries).
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
  -- lock the booking first (serialises finalise for this booking),
  -- then the trip (serialises capacity across racers). Consistent order.
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
    -- capacity decision, only while still pending (idempotent on retry)
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

    -- trip-money ledger row (downpayment for deposit, full cost for pay-in-full)
    if p_kind = 'deposit' then
      insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
        values (p_booking_id, p_intent_id, p_charge_id, 'deposit', v_downpay, 'succeeded')
        on conflict (stripe_payment_intent_id, type) do nothing;
    else
      v_trip_cost := public.compute_trip_cost(p_booking_id);
      insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
        values (p_booking_id, p_intent_id, p_charge_id, 'deposit', v_trip_cost, 'succeeded')
        on conflict (stripe_payment_intent_id, type) do nothing;
    end if;

    -- damage-deposit ledger row + state machine (the £100, captured up front)
    insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
      values (p_booking_id, p_intent_id, p_charge_id, 'damage_deposit_hold', v_damage, 'succeeded')
      on conflict (stripe_payment_intent_id, type) do nothing;
    insert into public.damage_deposits (booking_id, amount, status, stripe_payment_intent_id)
      values (p_booking_id, v_damage, 'held', p_intent_id)
      on conflict do nothing;

    update public.holds set status = 'consumed'
     where booking_id = p_booking_id and status = 'active';

  elsif p_kind = 'balance' then
    insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
      values (p_booking_id, p_intent_id, p_charge_id, 'balance', p_amount_total, 'succeeded')
      on conflict (stripe_payment_intent_id, type) do nothing;
  else
    raise exception 'unknown payment kind: %', p_kind;
  end if;

  return v_status;
end;
$$;

-- Admin: promote a waitlisted booking. Requires room (admin raises capacity
-- first, in the admin UI); audited by the caller.
create or replace function public.admin_convert_booking(p_booking_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_trip uuid; v_status public.booking_status; v_capacity int; v_confirmed int;
begin
  select trip_id, status into v_trip, v_status
    from public.bookings where id = p_booking_id for update;
  if v_status <> 'waitlisted' then raise exception 'booking is not waitlisted'; end if;

  select capacity, confirmed_count into v_capacity, v_confirmed
    from public.trips where id = v_trip for update;
  if v_confirmed >= v_capacity then
    raise exception 'trip at capacity — increase capacity before converting';
  end if;

  update public.bookings set status = 'converted' where id = p_booking_id;
  update public.trips set confirmed_count = confirmed_count + 1 where id = v_trip;
end;
$$;

-- ── Execute privileges (least privilege) ────────────────────────────────────
-- Money/capacity finalisation + admin + sweep: server-side (service_role) only.
revoke execute on function public.record_payment_and_finalize(uuid, text, text, text, integer) from public;
revoke execute on function public.admin_convert_booking(uuid) from public;
revoke execute on function public.expire_stale_holds() from public;
revoke execute on function public.compute_trip_cost(uuid) from public;
revoke execute on function public.booking_trip_paid(uuid) from public;
revoke execute on function public.booking_balance(uuid) from public;
revoke execute on function public.generate_booking_reference(uuid) from public;

grant execute on function public.record_payment_and_finalize(uuid, text, text, text, integer) to service_role;
grant execute on function public.admin_convert_booking(uuid) to service_role;
grant execute on function public.expire_stale_holds() to service_role;
grant execute on function public.compute_trip_cost(uuid) to service_role;
grant execute on function public.booking_trip_paid(uuid) to service_role;
grant execute on function public.booking_balance(uuid) to service_role;

-- Client-callable RPCs (post-login flow): authenticated users.
grant execute on function public.redeem_trip_code(text) to authenticated;
grant execute on function public.trip_effective_full(uuid) to authenticated;
grant execute on function public.start_booking(uuid) to authenticated;
grant execute on function public.release_hold(uuid) to authenticated;
