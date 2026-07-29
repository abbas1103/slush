-- ─────────────────────────────────────────────────────────────────────────
-- Audit remediation: RLS hardening + schema integrity (package P1c).
-- Fixes confirmed by the adversarial audit:
--   #4          every admin read policy gated on the JWT role only, so a
--               password-only (aal1) admin could read the whole student roster
--               straight off PostgREST, bypassing requireAdminMfa()
--   #58         trips.capacity + confirmed_count were readable by anon,
--               publishing the exact number of remaining places
--   #60 / #65   clients kept INSERT/UPDATE/DELETE on emergency_contacts, which
--               bypasses the PII encryption path (the users hole was closed in
--               091400; this mirrors it)
--   #19         trip_availability ran with its owner's rights, bypassing RLS
--               on trips and holds, and was reachable by anon
--   #67 / #116  booking_extras, emergency_contacts and consents are written
--               delete-then-insert with nothing enforcing uniqueness
--   #68 / #111  nothing stopped confirmed_count being raised past capacity
--   #138        bookings.user_id had no explicit ON DELETE
--   #118        payments_intent_idx was a redundant prefix index
--   #100        CRM sync skipped waitlisted bookings and balance payments
-- ─────────────────────────────────────────────────────────────────────────

-- ── #4: admin reads now require a SECOND FACTOR, not just the admin role ────
-- public.is_admin() only reads app_metadata.role out of the JWT, so a session
-- that has passed the password but NOT the TOTP challenge satisfied it. The
-- browser holds both the publishable key and that aal1 token, so an admin whom
-- requireAdminMfa() had bounced to /admin/mfa could still call PostgREST
-- directly and read users, bookings, payments, emergency_contacts, consents,
-- trip_codes and audit_log. public.is_admin_mfa() additionally requires
-- aal = 'aal2', i.e. the second factor was actually presented this session.
--
-- MFA-ENROLMENT CARVE-OUT: there is nothing to carve out, and no lock-out risk.
-- /admin/security and /admin/mfa are role-gated only (requireAdmin, never
-- requireAdminMfa) precisely so an aal1 admin can reach them, and every call
-- they make - listFactors, unenroll, enroll, challenge, verify and
-- getAuthenticatorAssuranceLevel - goes to the Auth (GoTrue) API, not to
-- PostgREST. Neither screen reads a table in this schema. The one row an aal1
-- admin still needs, their own profile, stays readable via the self-row
-- predicate id = auth.uid() kept below.
-- The CMS itself is unaffected: every admin read goes through the service-role
-- client (lib/db/admin-queries.ts), which bypasses RLS entirely. So even if
-- TOTP were disabled on the project and no session could reach aal2, tightening
-- these policies cannot break a single admin screen.

drop policy if exists trips_read_auth on public.trips;
create policy trips_read_auth on public.trips
  for select to authenticated
  using (
    status = 'live'
    or public.is_admin_mfa()
    or exists (
      select 1 from public.bookings b
      where b.trip_id = trips.id and b.user_id = (select auth.uid())
    )
  );

drop policy if exists extras_read on public.extras;
create policy extras_read on public.extras
  for select to anon, authenticated
  using (public.is_admin_mfa() or (active and public.trip_is_public(trip_id)));

drop policy if exists extra_tiers_read on public.extra_tiers;
create policy extra_tiers_read on public.extra_tiers
  for select to anon, authenticated
  using (public.is_admin_mfa() or public.extra_is_public(extra_id));

drop policy if exists trip_codes_admin_read on public.trip_codes;
create policy trip_codes_admin_read on public.trip_codes
  for select to authenticated
  using (public.is_admin_mfa());

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin_mfa());

drop policy if exists ec_select on public.emergency_contacts;
create policy ec_select on public.emergency_contacts
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_mfa());

drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_mfa());

drop policy if exists booking_extras_select on public.booking_extras;
create policy booking_extras_select on public.booking_extras
  for select to authenticated
  using (
    public.is_admin_mfa()
    or exists (
      select 1 from public.bookings b
      where b.id = booking_extras.booking_id and b.user_id = (select auth.uid())
    )
  );

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    public.is_admin_mfa()
    or exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id and b.user_id = (select auth.uid())
    )
  );

drop policy if exists damage_deposits_select on public.damage_deposits;
create policy damage_deposits_select on public.damage_deposits
  for select to authenticated
  using (
    public.is_admin_mfa()
    or exists (
      select 1 from public.bookings b
      where b.id = damage_deposits.booking_id and b.user_id = (select auth.uid())
    )
  );

drop policy if exists holds_select on public.holds;
create policy holds_select on public.holds
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_mfa());

drop policy if exists consents_select on public.consents;
create policy consents_select on public.consents
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_mfa());

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using (public.is_admin_mfa());

drop policy if exists crm_outbox_admin_read on public.crm_outbox;
create policy crm_outbox_admin_read on public.crm_outbox
  for select to authenticated
  using (public.is_admin_mfa());

-- ── #60 + #65: no direct client writes to emergency_contacts ───────────────
-- full_name and phone hold app-layer AES-256-GCM ciphertext written by
-- saveDetails with the service-role client. A client write put plaintext in
-- those columns (decryptPII then returns null, so next-of-kin renders blank),
-- deleted the contact outright, or inserted a duplicate. 091400 closed exactly
-- this hole on users; this mirrors it. app/(booking)/book/actions.ts writes
-- these rows with the service-role client, so nothing in the app changes.
drop policy if exists ec_insert_own on public.emergency_contacts;
drop policy if exists ec_update_own on public.emergency_contacts;
drop policy if exists ec_delete_own on public.emergency_contacts;
revoke insert, update, delete on public.emergency_contacts from authenticated;

-- ── #58: capacity is never public ──────────────────────────────────────────
-- The grant at 090600:30 was column-less, so every column of a live trip was
-- anon-readable, including capacity and the denormalised confirmed_count. The
-- brief forbids ever surfacing a remaining-places number; fullness reaches the
-- UI only as the boolean from trip_effective_full().
-- Restricted for anon only. Three reads still use select("*") on trips with the
-- logged-in client (lib/db/queries.ts, the confirmation page), and a
-- column-level grant makes select * fail outright - those select lists have to
-- be narrowed before the same revoke can be applied to `authenticated`. Every
-- anon-reachable path is safe today: /trip, /book, /dashboard and /tickets are
-- all gated by proxy.ts, and redeem_trip_code is granted to authenticated only.
revoke select on public.trips from anon;
grant select (
  id, name, organiser, resort, country, start_date, end_date, nights,
  base_price, base_inclusions, deposit_amount, downpayment_amount,
  damage_deposit_amount, balance_due_date, description, status, created_at
) on public.trips to anon;

-- ── #19: trip_availability must not bypass RLS ─────────────────────────────
-- Created without security_invoker, the view ran with its owner's privileges
-- and so saw every trips and holds row regardless of policy - and no GRANT or
-- REVOKE was written, so Supabase's legacy default privileges left it on the
-- Data API. Both halves are needed: security_invoker applies the caller's
-- policies, the revoke takes the endpoint away. The service role keeps complete
-- hold counts because it bypasses RLS.
alter view public.trip_availability set (security_invoker = true);
revoke all on public.trip_availability from anon, authenticated;

-- ── #67 + #116: uniqueness for the delete-then-insert writes ───────────────
-- Collapse anything a previous interleaved delete/insert left behind, keeping
-- the earliest row of each group, so the unique indexes below can be created.
-- A second booking_extras row for the same extra is always wrong: multiples are
-- modelled by the quantity column, and compute_trip_cost sums the rows, so a
-- duplicate is a straight overcharge.
delete from public.booking_extras be
 where exists (
   select 1 from public.booking_extras keep
    where keep.booking_id = be.booking_id
      and keep.extra_id = be.extra_id
      and (keep.created_at, keep.id) < (be.created_at, be.id)
 );

delete from public.emergency_contacts ec
 where exists (
   select 1 from public.emergency_contacts keep
    where keep.user_id = ec.user_id
      and (keep.created_at, keep.id) < (ec.created_at, ec.id)
 );

-- consents.booking_id is nullable; NULLs never match `=`, so rows not tied to a
-- booking are left alone (and stay allowed by the unique index below).
delete from public.consents c
 where exists (
   select 1 from public.consents keep
    where keep.booking_id = c.booking_id
      and (keep.created_at, keep.id) < (c.created_at, c.id)
 );

create unique index if not exists booking_extras_one_per_extra
  on public.booking_extras(booking_id, extra_id);
create unique index if not exists emergency_contacts_one_per_user
  on public.emergency_contacts(user_id);
create unique index if not exists consents_one_per_booking
  on public.consents(booking_id);

-- ── #68 + #111: confirmed_count can never be raised past capacity ──────────
-- A plain CHECK (capacity >= confirmed_count) would also block the legitimate
-- edit where beds are genuinely lost and the admin has to record a capacity
-- below the number already confirmed - the database would then be unable to
-- represent a real oversold trip, and the admin would have to refund students
-- before they could write down the truth. So the guard is one-directional: it
-- refuses to RAISE confirmed_count above capacity (the invariant the locked
-- functions depend on, now enforced by the database rather than by convention)
-- while still allowing an admin to lower capacity. Lowering it is fail-safe -
-- the trip reads as full and further payers are waitlisted, never oversold.
-- saveTrip should still warn the admin before it happens; that is app-side.
create or replace function public.trips_guard_confirmed_count()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prev integer := 0;
begin
  if tg_op = 'UPDATE' then
    v_prev := old.confirmed_count;
  end if;
  if new.confirmed_count > new.capacity and new.confirmed_count > v_prev then
    raise exception
      'trip % is full: confirmed_count % would exceed capacity %',
      new.id, new.confirmed_count, new.capacity;
  end if;
  return new;
end;
$$;

drop trigger if exists trips_confirmed_count_guard on public.trips;
create trigger trips_confirmed_count_guard
  before insert or update on public.trips
  for each row execute function public.trips_guard_confirmed_count();

-- ── #138: bookings.user_id keeps financial history, explicitly ─────────────
-- The FK had no ON DELETE, so it defaulted to NO ACTION and deleting a student
-- failed with a bare constraint violation. NO ACTION was the right intent -
-- CASCADE would destroy bookings that payments and damage_deposits reconcile
-- against, i.e. the append-only ledger - but it read like an oversight. Spell
-- it as RESTRICT so the intent is on the page: student rows are never deleted,
-- they are anonymised. The erasure path itself (overwrite the encrypted PII
-- columns and pseudonymise name/email, keeping the financial rows required for
-- accounting) is an app-side server action and is not part of this migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.bookings'::regclass
       and conname = 'bookings_user_id_fkey'
       and confdeltype = 'r'
  ) then
    alter table public.bookings drop constraint if exists bookings_user_id_fkey;
    alter table public.bookings
      add constraint bookings_user_id_fkey
      foreign key (user_id) references public.users(id) on delete restrict;
  end if;
end;
$$;

-- ── #118 + index hygiene ───────────────────────────────────────────────────
-- payments_intent_idx is fully covered as a leading-column prefix of the
-- partial unique index payments_intent_type_uidx, and no query filters on the
-- intent alone. The other four drops are the same argument: each is an exact
-- prefix of a unique index created above, or of the composite added here, so it
-- can only add write amplification. payments(booking_id, status, type) is the
-- shape booking_trip_paid() and the dashboard/confirmation reads actually
-- issue, and it supersedes payments_booking_idx.
-- (holds(trip_id, status, expires_at) is already indexed as
--  holds_trip_status_expiry_idx, so the hold sweep needs nothing new.)
create index if not exists payments_booking_status_type_idx
  on public.payments(booking_id, status, type);

drop index if exists public.payments_intent_idx;
drop index if exists public.payments_booking_idx;
drop index if exists public.booking_extras_booking_idx;
drop index if exists public.emergency_contacts_user_idx;
drop index if exists public.consents_booking_idx;

-- ── #100: CRM sync covers waitlisted bookings and balance payments ─────────
-- 'waitlisted' was missing from the status list, so the group with the largest
-- refund liability was never pushed at all. And a balance payment changes no
-- booking status, so nothing re-synced after it - yet paidToTripPence and
-- balancePence dominate the payload, leaving the CRM showing a balance the
-- student has already cleared. Coalescing stays the adapter's job (it upserts
-- by reference), so an extra queued row is harmless.
create or replace function public.enqueue_crm_booking_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('confirmed', 'converted', 'waitlisted', 'refunded', 'cancelled') then
    insert into public.crm_outbox (event_type, entity_id) values ('booking_sync', new.id);
  end if;
  return new;
end;
$$;

-- Trip money moved, so the CRM's balance is stale: re-sync the booking. The
-- types listed are exactly the ones booking_trip_paid() counts - the
-- damage-deposit rows are held and returned separately and never touch the trip
-- balance, so they would queue a sync that changed nothing. payments is
-- append-only (no path updates a row's status), so AFTER INSERT is enough.
create or replace function public.enqueue_crm_payment_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'succeeded'
     and new.type in ('deposit', 'balance', 'waitlist_refund') then
    insert into public.crm_outbox (event_type, entity_id) values ('booking_sync', new.booking_id);
  end if;
  return new;
end;
$$;

drop trigger if exists payment_crm_sync on public.payments;
create trigger payment_crm_sync
  after insert on public.payments
  for each row execute function public.enqueue_crm_payment_sync();

-- ── Table privileges: RLS is no longer the only line of defence ────────────
-- The least-privilege grant block at 090600:26-41 is inert on the provisioned
-- project: Supabase's legacy default privileges had already granted anon and
-- authenticated ALL privileges on every table in this schema. Writes are denied
-- today only because no INSERT/UPDATE/DELETE policy exists - and TRUNCATE is
-- not subject to RLS at all, so both client roles held a privilege that could
-- empty the payments ledger. Every write in the app goes through a SECURITY
-- DEFINER RPC or the service-role client, so no client role needs any of this.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;

-- anon has no legitimate read of any student or financial table (every policy
-- on them is `to authenticated`), and stripe_events - full webhook payloads -
-- is read only by the service role. Take the privilege away as well as the row.
revoke select on
  public.users, public.emergency_contacts, public.bookings, public.booking_extras,
  public.payments, public.damage_deposits, public.holds, public.consents,
  public.audit_log, public.trip_codes, public.crm_outbox, public.stripe_events
  from anon;
revoke select on public.stripe_events from authenticated;
