-- ─────────────────────────────────────────────────────────────────────────
-- Post-remediation review fix: restore a single global lock order.
--
-- 20260729000200 moved start_booking's "expire stale holds" sweep OUTSIDE the
-- trip-row critical section as a throughput tweak for audit #117. That made
-- start_booking take row locks in the order
--     bookings -> holds -> trips
-- while record_payment_and_finalize (same migration) takes them in the order
--     bookings -> trips -> holds
-- (it locks the trip, then flips the student's hold to 'consumed').
--
-- Both begin at bookings, but on DIFFERENT rows - student A is starting a
-- booking while student B's payment finalises - so the bookings lock does not
-- serialise the two. That leaves a genuine cycle:
--     T1 start_booking      holds a lock on a holds row, waits for trips
--     T2 finalize           holds the trips lock,        waits for that holds row
-- Postgres breaks it by aborting one side with SQLSTATE 40P01. When the loser
-- is the webhook, finalize 5xxs and Stripe retries for up to three days; when
-- it is the student, "Book this trip" fails with an opaque error.
--
-- The sweep is hygiene only: every count below it already filters on
-- `expires_at > now()`, and pg_cron sweeps every minute regardless, so moving
-- it back inside the critical section changes no result. It costs one indexed
-- UPDATE inside the lock, which is the correct price for removing a deadlock
-- from the payment path. #117 keeps the part of its win that was actually
-- safe: the already-placed-student early return still exits before the trip
-- lock is ever taken.
--
-- Only the position of that one UPDATE differs from the 000200 definition.
-- ─────────────────────────────────────────────────────────────────────────

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

  -- ── critical section: capacity read + hold write under the trip row lock ──
  select t.capacity, t.confirmed_count
    into v_capacity, v_confirmed
    from public.trips t where t.id = v_trip for update;

  -- Hygiene, and it MUST stay after the trip lock: touching holds first is what
  -- inverted the lock order against finalize (see the header). Every count
  -- below already ignores expired holds, so this only tidies state.
  update public.holds h set status = 'expired'
   where h.trip_id = v_trip and h.status = 'active' and h.expires_at <= now();

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

-- CREATE OR REPLACE keeps existing grants (the signature is unchanged), but
-- restate them so this migration is correct on a from-scratch `db reset` too.
revoke all on function public.start_booking(text) from public, anon;
grant execute on function public.start_booking(text) to authenticated;
