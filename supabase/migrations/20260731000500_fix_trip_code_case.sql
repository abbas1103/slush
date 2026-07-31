-- ─────────────────────────────────────────────────────────────────────────
-- Trip codes were case-sensitive in practice, despite being declared citext.
--
-- Found in QA: "BRUMSKI-DEC-26" resolves, "brumski-dec-26" and
-- "Brumski-Dec-26" both return "we couldn't find a trip for that code". The
-- trip code is the only way into the product, and a phone keyboard that
-- autocapitalises the first letter breaks it for a perfectly valid code.
--
-- trip_codes.code IS citext (20260715090000_extensions_enums.sql:8, commented
-- "case-insensitive email + trip code"), so `tc.code = p_code` *should* be
-- case-insensitive. It isn't, and there are TWO independent reasons - both
-- present here, each verified on a scratch Postgres 17 cluster:
--
--   1. The parameter is declared `text`. The only citext equality operator is
--      `citext = citext`, so `citext_col = text_param` resolves through the
--      implicit citext->text cast to the built-in, case-SENSITIVE
--      `pg_catalog.=(text,text)`. This happens whatever the search_path is.
--   2. Both readers are declared `set search_path = ''`. Operator lookup is by
--      name, so with an empty search_path the `citext = citext` operator in
--      `public` is invisible and the comparison falls back to text = text even
--      when BOTH sides are citext - casting the parameter to public.citext does
--      NOT rescue it.
--
-- So `p_code::public.citext` would not have been enough. Comparing on lower()
-- is what actually works here: `lower()` and `=(text,text)` are in pg_catalog,
-- which is always resolvable, so the fix is independent of both the parameter
-- type and the search_path, and keeps the `search_path = ''` hardening intact.
--
-- Cost: this filter cannot use the citext unique index, so the lookup is a seq
-- scan. On a table holding a handful of trip codes that is irrelevant; if the
-- code list ever grows, add `create index on trip_codes (lower(code::text))`.
--
-- Case-uniqueness is unaffected: trip_codes.code keeps its citext UNIQUE
-- index, so two codes differing only in case still cannot coexist.
--
-- Only that one WHERE clause differs from the previous definition of each
-- function; start_booking is otherwise reproduced verbatim from
-- 20260729000400_fix_start_booking_lock_order.sql, preserving its
-- bookings -> trips -> holds lock order and the in-critical-section sweep.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.redeem_trip_code(p_code text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select tc.trip_id
    from public.trip_codes tc
    join public.trips t on t.id = tc.trip_id
   where lower(tc.code::text) = lower(p_code) and tc.active and t.status = 'live'
   limit 1;
$$;

revoke all on function public.redeem_trip_code(text) from public, anon;
grant execute on function public.redeem_trip_code(text) to authenticated;

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

  -- lower() on both sides: see the header. This is the only line that differs
  -- from the 20260729000400 definition.
  select tc.id, tc.trip_id, tc.active, t.status, t.base_price
    into v_code_id, v_trip, v_active, v_trip_status, v_base_price
    from public.trip_codes tc join public.trips t on t.id = tc.trip_id
   where lower(tc.code::text) = lower(p_code)
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
  -- inverted the lock order against finalize. Every count below already ignores
  -- expired holds, so this only tidies state.
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
