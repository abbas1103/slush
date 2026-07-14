-- ─────────────────────────────────────────────────────────────────────────
-- Row Level Security: deny by default, explicit policies per table.
-- Grants are least-privilege: clients get SELECT (+ self-service writes on their
-- own contact/profile only). All booking/financial writes go through
-- SECURITY DEFINER RPCs or the service role — never a direct client write.
-- (RLS is already enabled via the project's auto-RLS trigger; re-enabling here
--  keeps the migration portable to a project without it. We do NOT force RLS,
--  so SECURITY DEFINER functions and the service role still bypass it.)
-- ─────────────────────────────────────────────────────────────────────────

alter table trips              enable row level security;
alter table trip_codes         enable row level security;
alter table extras             enable row level security;
alter table extra_tiers        enable row level security;
alter table users              enable row level security;
alter table emergency_contacts enable row level security;
alter table bookings           enable row level security;
alter table booking_extras     enable row level security;
alter table payments           enable row level security;
alter table damage_deposits    enable row level security;
alter table holds              enable row level security;
alter table consents           enable row level security;
alter table audit_log          enable row level security;
alter table stripe_events      enable row level security;

-- ── Grants (least privilege) ───────────────────────────────────────────────
grant usage on schema public to anon, authenticated;

-- public catalogue: read-only
grant select on trips, extras, extra_tiers to anon, authenticated;

-- self-service profile + contacts
grant select, update on users to authenticated;
grant select, insert, update, delete on emergency_contacts to authenticated;

-- own booking/financial data: read-only for clients (writes via RPC/service role)
grant select on bookings, booking_extras, payments, damage_deposits, holds, consents
  to authenticated;

-- admin-only reads still need a table grant (RLS then restricts rows to admins)
grant select on trip_codes, audit_log to authenticated;

-- stripe_events + all writes to financial/booking tables: service role only
-- (service_role has BYPASSRLS; it needs no policies).

-- ── Catalogue: public read of LIVE content; admin reads everything ─────────
create policy trips_read_anon on trips
  for select to anon
  using (status = 'live');

create policy trips_read_auth on trips
  for select to authenticated
  using (
    status = 'live'
    or public.is_admin()
    or exists (
      select 1 from bookings b
      where b.trip_id = trips.id and b.user_id = (select auth.uid())
    )
  );

create policy extras_read on extras
  for select to anon, authenticated
  using (public.is_admin() or (active and public.trip_is_public(trip_id)));

create policy extra_tiers_read on extra_tiers
  for select to anon, authenticated
  using (public.is_admin() or public.extra_is_public(extra_id));

-- trip_codes: never publicly readable (redeemed via SECURITY DEFINER RPC).
-- Admins may read for management.
create policy trip_codes_admin_read on trip_codes
  for select to authenticated
  using (public.is_admin());

-- ── User profile + emergency contacts (own rows; admins read all) ──────────
create policy users_select on users
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy users_update_own on users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy ec_select on emergency_contacts
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy ec_insert_own on emergency_contacts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy ec_update_own on emergency_contacts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy ec_delete_own on emergency_contacts
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── Booking + financial data: own rows readable; admins read all. ──────────
create policy bookings_select on bookings
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy booking_extras_select on booking_extras
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from bookings b
      where b.id = booking_extras.booking_id and b.user_id = (select auth.uid())
    )
  );

create policy payments_select on payments
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from bookings b
      where b.id = payments.booking_id and b.user_id = (select auth.uid())
    )
  );

create policy damage_deposits_select on damage_deposits
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from bookings b
      where b.id = damage_deposits.booking_id and b.user_id = (select auth.uid())
    )
  );

create policy holds_select on holds
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy consents_select on consents
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- ── Admin-only audit trail read ────────────────────────────────────────────
create policy audit_log_admin_read on audit_log
  for select to authenticated
  using (public.is_admin());

-- NOTE: no INSERT/UPDATE/DELETE policies exist for bookings, booking_extras,
-- payments, damage_deposits, holds, consents, trips, extras, extra_tiers,
-- trip_codes, audit_log or stripe_events for anon/authenticated. Those writes
-- are performed by SECURITY DEFINER RPCs (owner-privileged) or the service role,
-- keeping status/price/capacity out of client control entirely.
