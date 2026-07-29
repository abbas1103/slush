-- ─────────────────────────────────────────────────────────────────────────
-- Audit remediation: close the EXECUTE hole on the privileged RPCs.
--
-- WHY THE EARLIER `revoke ... from public` DID NOTHING (read this before you
-- touch a grant in this project):
--
--   In PostgreSQL, PUBLIC is a PSEUDO-ROLE. It means "the implicit privilege
--   every role inherits", NOT "every role". `revoke execute ... from public`
--   removes only that implicit privilege. It does NOT remove a privilege that
--   was granted DIRECTLY to a named role.
--
--   Supabase projects historically ship
--       alter default privileges in schema public
--         grant all on functions to postgres, anon, authenticated, service_role;
--   so every function created afterwards gets EXECUTE granted DIRECTLY to
--   `anon` and `authenticated`. The revokes at the bottom of
--   20260715090700_functions_core.sql left that grant completely intact.
--
--   Consequence (audit finding #3, critical): record_payment_and_finalize,
--   admin_convert_booking, expire_stale_holds, compute_trip_cost,
--   booking_trip_paid, booking_balance and generate_booking_reference were
--   callable over PostgREST with nothing but the browser-visible publishable
--   key. That is a confirmed, fully paid place for zero pounds, plus the
--   ability to drive confirmed_count to capacity and force real customers onto
--   the waitlist.
--
-- The fix is three independent layers, because any one of them can be lost
-- again by a careless `create or replace` or a new migration:
--   1. role-level revokes on every privileged function (public, anon, authenticated);
--   2. default privileges revoked, so FUTURE objects are not auto-exposed;
--   3. guards inside the function bodies, so a restored grant is not enough.
--
-- Rule of thumb from here on: always revoke from `public, anon, authenticated`
-- together, never from `public` alone. Revoking a privilege a role never held
-- is a silent no-op, so all of the below is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Layer 3: guards inside the bodies ───────────────────────────────────────
-- Each guard is defence in depth. The revokes further down are still the
-- primary gate; these exist so that restoring a grant by accident is not
-- immediately exploitable.
--
-- The "is this the trusted server?" test is `auth.uid() is null`. Both real
-- callers of the privileged paths use the service-role client
-- (lib/supabase/admin.ts), whose key carries no `sub` claim, and the pg_cron
-- sweep (20260715090900_cron.sql) runs in a background session with no
-- request.jwt.* settings at all. Neither has an auth.uid(). A request that DOES
-- carry an end-user uid is therefore never a legitimate caller of these.

-- Money actually received toward the trip: deposit downpayment + balance
-- payments, minus the trip-applied portion (£50) of any waitlist refund.
-- Body unchanged; ownership guard added.
create or replace function public.booking_trip_paid(p_booking_id uuid)
returns integer
language plpgsql stable security definer
set search_path = ''
as $$
declare v_paid int;
begin
  if auth.uid() is not null
     and not public.is_admin()
     and not exists (select 1 from public.bookings b
                      where b.id = p_booking_id and b.user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;

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
                   and p.status = 'succeeded'), 0)
    into v_paid;
  return v_paid;
end;
$$;

-- Outstanding balance = C − trip paid. Body unchanged; ownership guard added.
create or replace function public.booking_balance(p_booking_id uuid)
returns integer
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not public.is_admin()
     and not exists (select 1 from public.bookings b
                      where b.id = p_booking_id and b.user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;

  return public.compute_trip_cost(p_booking_id) - public.booking_trip_paid(p_booking_id);
end;
$$;

-- NOT re-created here on purpose:
--   * compute_trip_cost(uuid) and record_payment_and_finalize(...) are rewritten
--     by 20260729000200 (base_price_at_booking). Re-creating them here would be
--     clobbered by that migration, which runs after this one. The same guards
--     belong in THAT rewrite: the ownership guard above for compute_trip_cost,
--     and `if auth.uid() is not null then raise exception 'forbidden'; end if;`
--     as the first statement of record_payment_and_finalize.
--   * generate_booking_reference(uuid) must NOT get an auth.uid() guard: it is
--     called from inside start_booking on behalf of a signed-in student, where
--     auth.uid() is legitimately set. The revoke below is its whole fix.

-- Cron sweep: expire stale holds and cancel abandoned pending bookings.
-- Body unchanged; service-role/cron-only guard added.
create or replace function public.expire_stale_holds()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_count int;
begin
  if auth.uid() is not null then
    raise exception 'forbidden';
  end if;

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

-- Admin: promote a waitlisted booking. Requires room (admin raises capacity
-- first, in the admin UI); audited by the caller.
-- Two fixes: an authorisation guard, and #112 below.
create or replace function public.admin_convert_booking(p_booking_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_trip uuid; v_status public.booking_status; v_capacity int; v_confirmed int;
begin
  -- Callable by the admin server action (service role, no auth.uid(), already
  -- behind requireAdminMfa) or by a signed-in admin. Nobody else.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select trip_id, status into v_trip, v_status
    from public.bookings where id = p_booking_id for update;

  -- #112: with no matching row v_status was NULL, `NULL <> 'waitlisted'` is
  -- NULL, so the status guard never fired, both UPDATEs matched zero rows and
  -- the admin UI reported a conversion that never happened (plus an audit_log
  -- entry for it). Check the row exists first, and compare with IS DISTINCT
  -- FROM so a NULL can never fall through again.
  if v_trip is null then raise exception 'booking not found'; end if;
  if v_status is distinct from 'waitlisted' then raise exception 'booking is not waitlisted'; end if;

  select capacity, confirmed_count into v_capacity, v_confirmed
    from public.trips where id = v_trip for update;
  if v_confirmed >= v_capacity then
    raise exception 'trip at capacity - increase capacity before converting';
  end if;

  update public.bookings set status = 'converted' where id = p_booking_id;
  update public.trips set confirmed_count = confirmed_count + 1 where id = v_trip;
end;
$$;

-- ── Layer 1: role-level revokes on every privileged function ────────────────
-- Money/capacity finalisation, admin conversion, the sweep, the money readers
-- and the reference generator: server-side (service_role) only. Signatures must
-- match the LATEST definition exactly or the revoke silently targets nothing.
revoke all on function public.record_payment_and_finalize(uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.admin_convert_booking(uuid)      from public, anon, authenticated;
revoke all on function public.expire_stale_holds()             from public, anon, authenticated;
revoke all on function public.compute_trip_cost(uuid)          from public, anon, authenticated;
revoke all on function public.booking_trip_paid(uuid)          from public, anon, authenticated;
revoke all on function public.booking_balance(uuid)            from public, anon, authenticated;
revoke all on function public.generate_booking_reference(uuid) from public, anon, authenticated;

-- ── Finding #59: the client-callable RPCs were never revoked from PUBLIC ────
-- redeem_trip_code and trip_effective_full read the hidden trip_codes table and
-- got a grant to `authenticated` with no matching revoke, so PostgreSQL's own
-- default EXECUTE-to-PUBLIC left them open to unauthenticated callers: a trip
-- code could be brute-forced straight against PostgREST, bypassing the Upstash
-- limiter in app/(booking)/trip/actions.ts entirely. start_booking and
-- release_hold had the same gap (they raise 'not authenticated' internally, but
-- an anon caller should never reach the body at all).
-- These four stay deliberately client-callable, so they keep `authenticated`.
-- (start_booking's original uuid overload was dropped in
-- 20260715091000_start_booking_by_code.sql, so only the text one exists.)
revoke all on function public.redeem_trip_code(text)     from public, anon;
revoke all on function public.trip_effective_full(uuid)  from public, anon;
revoke all on function public.start_booking(text)        from public, anon;
revoke all on function public.release_hold(uuid)         from public, anon;

-- ── The capacity read model was documented as server-only but never locked ──
-- trip_availability exposes an exact remaining-places count, which the brief
-- forbids surfacing to students. Nothing in app/ or lib/ reads it.
revoke all on table public.trip_availability from anon, authenticated;

-- ── Layer 2: stop FUTURE objects auto-exposing themselves ───────────────────
-- These apply to objects created from now on by the role running migrations,
-- and change nothing about existing objects. The `from public` line matters:
-- PostgreSQL's own built-in default grants EXECUTE on every new function to
-- PUBLIC, so revoking from anon/authenticated alone would leave new functions
-- reachable through PUBLIC.
--
-- CONSEQUENCE FOR FUTURE WORK, please read: a new function that is used inside
-- an RLS policy, or is meant to be called from the browser, now needs an
-- explicit `grant execute ... to authenticated;`. Policy expressions are
-- evaluated as the querying role, so a missing grant denies every read on that
-- table rather than failing loudly in one place.
alter default privileges in schema public revoke all     on tables    from anon, authenticated;
alter default privileges in schema public revoke all     on sequences from anon, authenticated;
alter default privileges in schema public revoke all     on functions from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

-- ── Re-grant everything the app legitimately needs ──────────────────────────
-- Client-callable RPCs (post-login booking flow).
grant execute on function public.redeem_trip_code(text)    to authenticated;
grant execute on function public.trip_effective_full(uuid) to authenticated;
grant execute on function public.start_booking(text)       to authenticated;
grant execute on function public.release_hold(uuid)        to authenticated;

-- RLS policy helpers MUST stay executable by the client roles. Every policy in
-- 20260715090600_rls_policies.sql calls at least one of these, and a policy is
-- evaluated as the querying role, so losing EXECUTE here breaks all reads.
grant execute on function public.is_admin()                to anon, authenticated;
grant execute on function public.is_admin_mfa()            to anon, authenticated;
grant execute on function public.trip_is_public(uuid)      to anon, authenticated;
grant execute on function public.extra_is_public(uuid)     to anon, authenticated;

-- The webhook / admin / cron paths (service_role bypasses RLS but still needs
-- EXECUTE). Re-stated for the functions re-created above.
grant execute on function public.record_payment_and_finalize(uuid, text, text, text, integer)
  to service_role;
grant execute on function public.admin_convert_booking(uuid) to service_role;
grant execute on function public.expire_stale_holds()        to service_role;
grant execute on function public.compute_trip_cost(uuid)     to service_role;
grant execute on function public.booking_trip_paid(uuid)     to service_role;
grant execute on function public.booking_balance(uuid)       to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFICATION - paste into the Supabase SQL editor after applying.
--
-- 1. Who can execute what? Expect can_execute = false for anon AND
--    authenticated on: record_payment_and_finalize, admin_convert_booking,
--    expire_stale_holds, compute_trip_cost, booking_trip_paid, booking_balance,
--    generate_booking_reference. Expect true for authenticated only on
--    redeem_trip_code, trip_effective_full, start_booking, release_hold, and
--    true for both roles on is_admin, is_admin_mfa, trip_is_public,
--    extra_is_public.
--
-- select p.proname,
--        pg_get_function_identity_arguments(p.oid) as args,
--        r.rolname,
--        has_function_privilege(r.rolname, p.oid, 'execute') as can_execute
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   cross join (values ('anon'), ('authenticated')) as r(rolname)
--  where n.nspname = 'public'
--  order by p.proname, r.rolname;
--
-- 2. No client role may read the capacity read model. Expect zero rows.
--
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'trip_availability'
--    and grantee in ('anon', 'authenticated');
--
-- 3. Future objects are no longer auto-exposed. Expect no anon= or
--    authenticated= entry, and no bare `=X/` (PUBLIC) entry for functions.
--
-- select defaclrole::regrole as owner, defaclnamespace::regnamespace as schema,
--        defaclobjtype as objtype, defaclacl
--   from pg_default_acl;
--
-- 4. Did anyone already exploit this? Every genuine row comes from the Stripe
--    webhook, so the intent id starts 'pi_' and the charge id is present.
--    Expect zero rows; any row here is a fabricated payment to be investigated
--    against the Stripe dashboard before go-live.
--
-- select id, booking_id, type, amount, status, stripe_payment_intent_id,
--        stripe_charge_id, created_at
--   from public.payments
--  where stripe_payment_intent_id is null
--     or stripe_payment_intent_id not like 'pi_%'
--     or stripe_charge_id is null
--  order by created_at;
-- ─────────────────────────────────────────────────────────────────────────
