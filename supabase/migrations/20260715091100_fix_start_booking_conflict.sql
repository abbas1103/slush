-- ─────────────────────────────────────────────────────────────────────────
-- Fix: start_booking's RETURNS TABLE output columns (booking_id, is_waitlist,
-- expires_at) share names with the holds table columns referenced in the body,
-- which Postgres reports as ambiguous (SQLSTATE 42702). The
-- `#variable_conflict use_column` directive resolves unqualified names to the
-- table column (all our locals are v_-prefixed, so nothing else is affected).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.start_booking(p_code text)
returns table (booking_id uuid, is_waitlist boolean, expires_at timestamptz)
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

  select tc.id, tc.trip_id, tc.active, t.status
    into v_code_id, v_trip, v_active, v_trip_status
    from public.trip_codes tc join public.trips t on t.id = tc.trip_id
   where tc.code = p_code
   limit 1;

  if v_code_id is null or not v_active or v_trip_status <> 'live' then
    raise exception 'invalid or inactive trip code';
  end if;

  select t.capacity, t.confirmed_count
    into v_capacity, v_confirmed
    from public.trips t where t.id = v_trip for update;

  update public.holds set status = 'expired'
   where trip_id = v_trip and status = 'active' and expires_at <= now();

  select count(*) into v_other_holds
    from public.holds
   where trip_id = v_trip and status = 'active' and expires_at > now()
     and user_id <> v_user;

  v_waitlist := (v_confirmed + v_other_holds) >= v_capacity;

  select id into v_booking
    from public.bookings
   where user_id = v_user and trip_id = v_trip
     and status not in ('cancelled', 'refunded')
   limit 1;

  if v_booking is null then
    v_ref := public.generate_booking_reference(v_trip);
    insert into public.bookings (user_id, trip_id, trip_code_id, reference, status)
      values (v_user, v_trip, v_code_id, v_ref, 'pending')
      returning id into v_booking;
  end if;

  update public.holds set status = 'released'
   where trip_id = v_trip and user_id = v_user and status = 'active';
  insert into public.holds (trip_id, user_id, booking_id, status, is_waitlist, expires_at)
    values (v_trip, v_user, v_booking, 'active', v_waitlist, v_expires);

  return query select v_booking, v_waitlist, v_expires;
end;
$$;

revoke execute on function public.start_booking(text) from public;
grant execute on function public.start_booking(text) to authenticated;
