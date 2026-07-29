-- ─────────────────────────────────────────────────────────────────────────
-- Money/capacity core remediation (audit findings 1, 2, 5, 10, 12, 14, 15,
-- 16, 46, 55, 61, 94, 117).
--
-- The through-line: a captured charge must ALWAYS leave a ledger row, and a
-- booking must never be cancelled while a PaymentIntent can still settle.
--   * record_payment_and_finalize writes payments + damage_deposits BEFORE it
--     attempts the status flip, so a placement failure can no longer roll back
--     the ledger for money Stripe has already taken (#2/#5/#12).
--   * the flip resolves the bookings_one_live_per_user_trip collision explicitly
--     and, when it cannot, queues the payment for human reconciliation instead
--     of raising and wedging Stripe in a 3-day retry loop (#2/#5/#12).
--   * damage_deposits is idempotent per (booking, intent) regardless of status,
--     so replaying finalize after a refund cannot re-arm a 'held' row (#1/#55).
--   * expire_stale_holds and release_hold leave a booking alone while its intent
--     is live, which is what created the collision in the first place (#14/#15).
--   * bookings.base_price_at_booking snapshots the price the student agreed to,
--     so an admin price edit can no longer reprice bookings already taken
--     (#10/#46).
--   * start_booking never hands a second hold to an already-placed student, and
--     returns their status so the UI can route them to their booking (#16/#61).
--   * places freed or added belong to the waiting list before they go back on
--     public sale, so an admin can raise capacity to convert without newcomers
--     jumping the queue (#94).
-- ─────────────────────────────────────────────────────────────────────────

-- ── #10/#46: snapshot the base price on the booking ────────────────────────
-- trips.base_price is now the price for NEW bookings only. Nullable on purpose:
-- legacy rows are backfilled below and compute_trip_cost coalesces, so nothing
-- has to be rewritten twice.
alter table public.bookings add column if not exists base_price_at_booking integer;

update public.bookings b
   set base_price_at_booking = t.base_price
  from public.trips t
 where t.id = b.trip_id
   and b.base_price_at_booking is null;

-- ── #1/#55: damage-deposit idempotency that survives a refund ──────────────
-- damage_deposits_one_live_per_booking is PARTIAL (status <> 'refunded'), so a
-- replayed finalize after the admin returned the £100 inserted a fresh 'held'
-- row and the admin UI offered "Refund damage" a second time.
--
-- First retire any phantom row the bug has already created: a 'held' duplicate
-- for the same (booking, intent) that post-dates a refunded/withheld row and
-- carries no refund of its own. The payments ledger rows are untouched -
-- damage_deposits is a state machine, not the money record. Anything else that
-- duplicates will fail the index below loudly, which is the right outcome.
delete from public.damage_deposits d
 where d.status = 'held'
   and d.stripe_refund_id is null
   and d.withheld_amount = 0
   and exists (select 1 from public.damage_deposits prior
                where prior.booking_id = d.booking_id
                  and prior.stripe_payment_intent_id = d.stripe_payment_intent_id
                  and prior.id <> d.id
                  and prior.status <> 'held'
                  and prior.created_at <= d.created_at);

-- This index holds regardless of status, and is the arbiter the insert now names.
create unique index if not exists damage_deposits_booking_intent_uidx
  on public.damage_deposits(booking_id, stripe_payment_intent_id);

-- ── #2/#5/#12: captured money that cannot be placed ────────────────────────
-- A charge whose booking cannot be promoted (another live booking for the same
-- student+trip already holds the place) lands here so a human refunds it. Money
-- is never invisible, and the webhook is never wedged in a retry loop.
-- Service-role only: RLS on, no policies, no grants to client roles.
create table payment_reconciliation_queue (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references bookings(id),
  stripe_payment_intent_id text not null,
  stripe_charge_id         text,
  amount                   integer not null,     -- pence actually captured
  reason                   text not null,
  metadata                 jsonb,                -- references + statuses, NO PII
  resolved_at              timestamptz,
  created_at               timestamptz not null default now(),
  constraint payment_reconciliation_amount_chk check (amount >= 0)
);
-- one open row per (intent, reason) so Stripe retries dedupe
create unique index payment_reconciliation_intent_reason_uidx
  on payment_reconciliation_queue(stripe_payment_intent_id, reason);
create index payment_reconciliation_open_idx
  on payment_reconciliation_queue(created_at) where resolved_at is null;

alter table payment_reconciliation_queue enable row level security;
-- Belt and braces on top of 20260729000100's default-privilege revokes: no
-- client role touches this table, and there is no policy for one to use.
revoke all on table payment_reconciliation_queue from anon, authenticated;

-- ── #10/#46: trip cost reads the snapshot, not the live catalogue price ────
-- 20260729000100 deliberately left compute_trip_cost to this migration and asked
-- for its ownership guard to be carried in here (that migration's layer-3
-- defence in depth); the same guard shape as booking_trip_paid/booking_balance.
create or replace function public.compute_trip_cost(p_booking_id uuid)
returns integer
language plpgsql stable security definer
set search_path = ''
as $$
declare v_cost int;
begin
  if auth.uid() is not null
     and not public.is_admin()
     and not exists (select 1 from public.bookings b
                      where b.id = p_booking_id and b.user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;

  -- #10/#46: the base price the student agreed to, falling back to the trip's
  -- current price only for rows taken before the snapshot column existed.
  select coalesce(b.base_price_at_booking, t.base_price)
         + coalesce((select sum(be.price_at_booking * be.quantity)
                       from public.booking_extras be
                      where be.booking_id = b.id), 0)
    into v_cost
    from public.bookings b join public.trips t on t.id = b.trip_id
   where b.id = p_booking_id;
  return v_cost;
end;
$$;

-- ── #94: the waiting list has first claim on any place ────────────────────
-- THE RULE (used identically by trip_effective_full, start_booking and
-- record_payment_and_finalize): a paid-but-waitlisted booking reserves one
-- place. So when SLUSH secures five more beds and the admin raises capacity,
-- the trip does NOT go back on public sale over the heads of the queue - the
-- newly added places stay reserved until admin_convert_booking hands them to
-- waitlisters (or the waitlisters are refunded, which releases them).
create or replace function public.trip_effective_full(p_trip_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (t.confirmed_count
          + coalesce((select count(*) from public.holds h
                       where h.trip_id = t.id and h.status = 'active' and h.expires_at > now()), 0)
          + coalesce((select count(*) from public.bookings b
                       where b.trip_id = t.id and b.status = 'waitlisted'), 0)
         ) >= t.capacity
    from public.trips t
   where t.id = p_trip_id;
$$;

-- ── #16/#61/#117: start_booking ────────────────────────────────────────────
-- Returns the booking's status now, so the UI can send an already-placed
-- student to their booking instead of the pay screen. Only a 'pending' booking
-- is resumable and only a 'pending' booking ever gets a hold.
drop function if exists public.start_booking(text);

create or replace function public.start_booking(p_code text)
returns table (booking_id uuid, status public.booking_status, is_waitlist boolean, expires_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user        uuid := auth.uid();
  v_code_id     uuid;
  v_trip        uuid;
  v_active      boolean;
  v_trip_status public.trip_status;
  v_base_price  int;
  v_capacity    int;
  v_confirmed   int;
  v_reserved    int;
  v_other_holds int;
  v_waitlist    boolean;
  v_booking     uuid;
  v_status      public.booking_status;
  v_ref         text;
  v_expires     timestamptz := now() + interval '30 minutes';
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select tc.id, tc.trip_id, tc.active, t.status, t.base_price
    into v_code_id, v_trip, v_active, v_trip_status, v_base_price
    from public.trip_codes tc join public.trips t on t.id = tc.trip_id
   where tc.code = p_code
   limit 1;

  if v_code_id is null or not v_active or v_trip_status <> 'live' then
    raise exception 'invalid or inactive trip code';
  end if;

  -- The student's live booking for this trip, if any. Locked FOR UPDATE so a
  -- finalise landing right now cannot flip it under us, and taken BEFORE the
  -- trip lock to keep the bookings-then-trips lock order finalise relies on.
  select b.id, b.status
    into v_booking, v_status
    from public.bookings b
   where b.user_id = v_user and b.trip_id = v_trip
     and b.status not in ('cancelled', 'refunded')
   limit 1
   for update;

  -- #16/#61: a confirmed/waitlisted/converted student already occupies a place.
  -- Minting them a fresh hold counted them twice in every hold-aware read and
  -- sent them to a checkout step that redirects. Hand the status back instead -
  -- and note this path never takes the trip lock at all (#117).
  if v_booking is not null and v_status <> 'pending' then
    return query select v_booking, v_status, false, null::timestamptz;
    return;
  end if;

  -- #117: hygiene only (every count below already ignores expired holds, and
  -- pg_cron sweeps every minute), so it runs OUTSIDE the critical section.
  update public.holds h set status = 'expired'
   where h.trip_id = v_trip and h.status = 'active' and h.expires_at <= now();

  -- ── critical section: capacity read + hold write under the trip row lock ──
  select t.capacity, t.confirmed_count
    into v_capacity, v_confirmed
    from public.trips t where t.id = v_trip for update;

  if v_booking is null then
    -- Authoritative under the trip lock: a concurrent start for the same
    -- student+trip (a double-click) may have created the booking while we were
    -- unlocked, and bookings_one_live_per_user_trip would reject a second one.
    -- Plain SELECT on purpose - taking a bookings row lock now would invert the
    -- bookings-then-trips order and could deadlock with finalise.
    select b.id, b.status
      into v_booking, v_status
      from public.bookings b
     where b.user_id = v_user and b.trip_id = v_trip
       and b.status not in ('cancelled', 'refunded')
     limit 1;

    if v_booking is not null and v_status <> 'pending' then
      return query select v_booking, v_status, false, null::timestamptz;
      return;
    end if;
  end if;

  if v_booking is null then
    v_ref := public.generate_booking_reference(v_trip);
    -- #10/#46: snapshot the price the student is agreeing to, here and nowhere else.
    insert into public.bookings (user_id, trip_id, trip_code_id, reference, status, base_price_at_booking)
      values (v_user, v_trip, v_code_id, v_ref, 'pending', v_base_price)
      returning id into v_booking;
    v_status := 'pending';
  end if;

  select count(*) into v_other_holds
    from public.holds h
   where h.trip_id = v_trip and h.status = 'active' and h.expires_at > now()
     and h.user_id <> v_user;

  -- #94: waitlisters have first claim on any place (see trip_effective_full).
  select count(*) into v_reserved
    from public.bookings b
   where b.trip_id = v_trip and b.status = 'waitlisted';

  v_waitlist := (v_confirmed + v_reserved + v_other_holds) >= v_capacity;

  -- refresh the student's hold (advisory; the authoritative decision is at payment)
  update public.holds h set status = 'released'
   where h.trip_id = v_trip and h.user_id = v_user and h.status = 'active';
  insert into public.holds (trip_id, user_id, booking_id, status, is_waitlist, expires_at)
    values (v_trip, v_user, v_booking, 'active', v_waitlist, v_expires);

  return query select v_booking, v_status, v_waitlist, v_expires;
end;
$$;

-- Re-stated because DROP discards the old grants. Always revoke from all three
-- roles, never `public` alone - see 20260729000100 for why.
revoke all on function public.start_booking(text) from public, anon, authenticated;
grant execute on function public.start_booking(text) to authenticated;

-- ── #15: release_hold must not cancel a booking mid-payment ────────────────
-- Cancelling a booking whose PaymentIntent is still confirmable left a
-- chargeable intent attached to a dead booking, let the student start a second
-- booking and pay again, and then sent the first charge into the collision
-- above. Returns a code so the caller can cancel the intent and retry.
drop function if exists public.release_hold(uuid);

create or replace function public.release_hold(p_booking_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_status public.booking_status;
  v_intent text;
begin
  if v_user is null then
    return 'not_found';
  end if;

  select b.status, b.payment_intent_id
    into v_status, v_intent
    from public.bookings b
   where b.id = p_booking_id and b.user_id = v_user
   for update;
  -- null for both "no such booking" and "not yours" - no information either way
  if v_status is null then
    return 'not_found';
  end if;

  -- A minted intent can still settle (3DS, Bacs, a slow redirect). Keep the
  -- hold and the booking so the money has somewhere to land; the caller must
  -- cancel the intent at Stripe first if the student really wants out.
  if v_intent is not null then
    return 'payment_in_flight';
  end if;

  update public.holds h set status = 'released'
   where h.booking_id = p_booking_id and h.user_id = v_user and h.status = 'active';

  if v_status = 'pending' then
    update public.bookings b set status = 'cancelled'
     where b.id = p_booking_id and b.user_id = v_user and b.status = 'pending';
  end if;

  return 'released';
end;
$$;

revoke all on function public.release_hold(uuid) from public, anon, authenticated;
grant execute on function public.release_hold(uuid) to authenticated;

-- ── #14: the sweep must not cancel a booking with a live intent ────────────
create or replace function public.expire_stale_holds()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_count int;
begin
  -- cron/service-role only (guard carried over from 20260729000100)
  if auth.uid() is not null then
    raise exception 'forbidden';
  end if;

  update public.holds set status = 'expired'
   where status = 'active' and expires_at <= now();
  get diagnostics v_count = row_count;

  -- Cancel abandoned pending bookings, but NEVER one carrying a PaymentIntent:
  -- payments rows only exist after finalise, so a booking mid-3DS looks
  -- abandoned to this sweep, and cancelling it is what stranded the charge.
  -- Those bookings keep their row; start_booking hands them back with a fresh
  -- hold, and finalise clears payment_intent_id once the intent is consumed.
  update public.bookings b set status = 'cancelled'
   where b.status = 'pending'
     and b.payment_intent_id is null
     and not exists (select 1 from public.holds h
                      where h.booking_id = b.id and h.status = 'active' and h.expires_at > now())
     and not exists (select 1 from public.payments p
                      where p.booking_id = b.id and p.status = 'succeeded');
  return v_count;
end;
$$;

-- ── #1/#2/#5/#12/#55/#94: the ledger, then the placement ──────────────────
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
  v_trip           uuid;
  v_user           uuid;
  v_status         public.booking_status;
  v_capacity       int;
  v_confirmed      int;
  v_reserved       int;
  v_downpay        int;
  v_damage         int;
  v_trip_paid      int;
  v_sibling        uuid;
  v_sibling_status public.booking_status;
  v_sibling_intent text;
begin
  -- Webhook / reconcile only, both of which use the service-role client and so
  -- carry no auth.uid() (guard requested by 20260729000100, layer 3). A request
  -- with an end-user uid is never a legitimate caller of the money path.
  if auth.uid() is not null then
    raise exception 'forbidden';
  end if;

  -- lock the booking first (serialises finalise for this booking),
  -- then the trip (serialises capacity across racers). Consistent order.
  select b.trip_id, b.user_id, b.status
    into v_trip, v_user, v_status
    from public.bookings b
   where b.id = p_booking_id
   for update;
  if v_trip is null then raise exception 'booking not found'; end if;

  -- #2/#5/#12: promoting a cancelled booking can collide with a newer live
  -- booking for the same student+trip on bookings_one_live_per_user_trip. Take
  -- that lock NOW, while we are still in the bookings stage of the lock order.
  -- (No cycle: a pending/confirmed booking never looks for a sibling, so two
  -- concurrent finalises can never wait on each other's booking row.)
  if p_kind in ('deposit', 'full') and v_status = 'cancelled' then
    select b.id, b.status, b.payment_intent_id
      into v_sibling, v_sibling_status, v_sibling_intent
      from public.bookings b
     where b.user_id = v_user and b.trip_id = v_trip
       and b.id <> p_booking_id
       and b.status not in ('cancelled', 'refunded')
     limit 1
     for update;
  end if;

  select t.capacity, t.confirmed_count, t.downpayment_amount, t.damage_deposit_amount
    into v_capacity, v_confirmed, v_downpay, v_damage
    from public.trips t where t.id = v_trip
   for update;

  if p_kind in ('deposit', 'full') then
    -- ── 1. THE LEDGER, FIRST ──────────────────────────────────────────────
    -- Stripe has the money. These rows are written before anything that can
    -- fail, so a placement problem below can never roll back the record of a
    -- captured charge (audit #2/#5/#12).
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

    -- #1/#55: one damage deposit per booking, for ever. The pre-check keeps a
    -- refunded row (outside the old partial index) from being re-armed as a
    -- fresh 'held' one; the ON CONFLICT is the concurrency backstop.
    if not exists (select 1 from public.damage_deposits d
                    where d.booking_id = p_booking_id) then
      insert into public.damage_deposits (booking_id, amount, status, stripe_payment_intent_id)
        values (p_booking_id, v_damage, 'held', p_intent_id)
        on conflict (booking_id, stripe_payment_intent_id) do nothing;
    end if;

    -- ── 2. THE PLACEMENT ──────────────────────────────────────────────────
    -- #3 (earlier audit): also place a booking the sweep cancelled after its
    -- hold expired - the customer paid, so they get a seat (or the waiting
    -- list). 'refunded' stays terminal and is never resurrected.
    if v_status in ('pending', 'cancelled') then
      if v_sibling is not null then
        if v_sibling_status = 'pending'
           and v_sibling_intent is null
           and not exists (select 1 from public.payments p
                            where p.booking_id = v_sibling and p.status = 'succeeded') then
          -- An empty unpaid shell: the student started over, then their first
          -- payment landed. Retire the shell so the paid booking takes the
          -- place. We refuse to touch a shell with its own live intent - that
          -- would strand a second chargeable intent (the double-charge shape).
          update public.bookings set status = 'cancelled' where id = v_sibling and status = 'pending';
          update public.holds set status = 'released'
           where booking_id = v_sibling and status = 'active';
          v_sibling := null;
        end if;
      end if;

      if v_sibling is not null then
        -- The student holds another PAID booking (or one mid-payment) for this
        -- trip, so this charge cannot be placed without breaking the one-live-
        -- booking rule. The ledger above stands; queue it for a human refund
        -- rather than raising, which would 500 the webhook for three days and
        -- leave the money invisible (audit #2/#5/#12).
        insert into public.payment_reconciliation_queue
            (booking_id, stripe_payment_intent_id, stripe_charge_id, amount, reason, metadata)
          values (p_booking_id, p_intent_id, nullif(p_charge_id, ''), p_amount_total,
                  'live_sibling_booking',
                  jsonb_build_object('sibling_booking_id', v_sibling,
                                     'sibling_status', v_sibling_status,
                                     'payment_kind', p_kind))
          on conflict (stripe_payment_intent_id, reason) do nothing;
      else
        begin
          -- #94: waitlisters reserve a place each, so a newcomer paying just
          -- after the admin raised capacity joins the back of the queue instead
          -- of taking the bed the queue was waiting for. confirmed_count can
          -- still never exceed capacity: v_reserved >= 0.
          select count(*) into v_reserved
            from public.bookings b
           where b.trip_id = v_trip and b.status = 'waitlisted'
             and b.id <> p_booking_id;

          if v_confirmed + v_reserved < v_capacity then
            update public.bookings set status = 'confirmed' where id = p_booking_id;
            update public.trips set confirmed_count = confirmed_count + 1 where id = v_trip;
            v_status := 'confirmed';
          else
            update public.bookings set status = 'waitlisted' where id = p_booking_id;
            v_status := 'waitlisted';
          end if;
        exception when unique_violation then
          -- Final backstop: something else claimed the live-booking slot
          -- between our lock and this UPDATE. v_status is untouched (the flip
          -- raised before it was assigned), the ledger above survives because
          -- only this block rolls back, and a human picks the payment up.
          insert into public.payment_reconciliation_queue
              (booking_id, stripe_payment_intent_id, stripe_charge_id, amount, reason, metadata)
            values (p_booking_id, p_intent_id, nullif(p_charge_id, ''), p_amount_total,
                    'placement_conflict',
                    jsonb_build_object('booking_status', v_status, 'payment_kind', p_kind))
            on conflict (stripe_payment_intent_id, reason) do nothing;
        end;
      end if;
    end if;

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

revoke all on function public.record_payment_and_finalize(uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_payment_and_finalize(uuid, text, text, text, integer) to service_role;

-- compute_trip_cost, trip_effective_full and expire_stale_holds were redefined
-- with CREATE OR REPLACE, which keeps the grants 20260729000100 set (compute_trip_cost
-- + expire_stale_holds: service_role only; trip_effective_full: authenticated).
