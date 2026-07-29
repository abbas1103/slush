-- ─────────────────────────────────────────────────────────────────────────
-- A second privileged role: `rep`.
--
-- WHY: the only role today is `admin`, and after 20260729000300 an admin can read
-- every student's decrypted passport, DOB, emergency contact and medical needs.
-- Anything that needs staff access - checking students onto a coach, scanning a
-- lift pass - would therefore have required handing seasonal staff a key to the
-- entire PII roster. `rep` exists so that does not happen.
--
-- WHERE THE ROLE LIVES: `auth.users.app_metadata.role`, keyed on auth.users.id.
-- The same place `admin` already lives, so these helpers need no table lookup and
-- cannot recurse through RLS.
--
--   app_metadata is writable ONLY with the service role.
--   user_metadata is writable BY THE USER via supabase.auth.updateUser().
--
-- That distinction is the whole security of this scheme. A role stored in
-- user_metadata would let any student promote themselves to admin from the
-- browser and read every passport in the database. Never move it.
--
-- SCOPE: `role` is a scalar, and the hierarchy is admin > rep. is_staff() is the
-- gate for "may do staff things"; is_admin() is unchanged and still means the CMS.
-- Being scalar, the role is also GLOBAL - a rep can act on any trip. That is fine
-- while there is one trip; a second trip wants a staff_trips(user_id, trip_id)
-- table checked in the handler, not a change to these functions.
--
-- NOTE: granting `rep` currently confers NOTHING. No policy references
-- is_staff() yet, because the scanner it exists for is not built. It is added
-- here so the role can be assigned and audited first, deliberately in that order.
-- ─────────────────────────────────────────────────────────────────────────

-- Staff = admin or rep. Mirrors is_admin()'s shape exactly.
create or replace function public.is_staff()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'rep'),
    false
  );
$$;

-- Staff AND a verified second factor. The counterpart to is_admin_mfa(); use this
-- in any policy that exposes student data, however minimal.
create or replace function public.is_staff_mfa()
returns boolean
language sql stable
set search_path = ''
as $$
  select public.is_staff()
     and coalesce((auth.jwt() ->> 'aal') = 'aal2', false);
$$;

-- Readable by both client roles for the same reason is_admin() is: RLS policies
-- evaluate these as the calling role, so the role must be able to execute them.
-- They disclose only a boolean about the caller's OWN token.
revoke all on function public.is_staff() from public;
revoke all on function public.is_staff_mfa() from public;
grant execute on function public.is_staff()     to anon, authenticated;
grant execute on function public.is_staff_mfa() to anon, authenticated;

-- ── Immediate revocation ───────────────────────────────────────────────────
-- Clearing app_metadata.role does NOT end an existing session: the role is a
-- claim inside an already-issued access token, so a revoked admin keeps CMS
-- access until that token expires (up to an hour). For a lost phone or a
-- dismissal mid-trip that is the wrong behaviour.
--
-- The Supabase admin API cannot help here. `auth.admin.signOut(jwt)` needs the
-- user's OWN token, which the server does not have, and `deleteUser` would
-- destroy the account and cascade to their booking. So this deletes their
-- sessions directly. auth.refresh_tokens references auth.sessions ON DELETE
-- CASCADE, so the refresh tokens go with them and the session cannot be renewed.
--
-- service_role only, by the same role test used in the money path: a request
-- carrying no claims (the service-role client) or claiming service_role passes;
-- anything else raises. anon has NO claims, so it is caught by the grant, which
-- is why the grant and the guard are both here.
create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_count int;
begin
  if current_setting('request.jwt.claims', true) is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFICATION - paste into the SQL editor after applying.
--
-- 1. The helpers exist and are callable by the client roles:
--      select has_function_privilege('authenticated', 'public.is_staff()', 'execute');
--
-- 2. Who currently holds a privileged role? (app_metadata is the only source of
--    truth; the CMS staff screen reads the same thing through the admin API.)
--      select id, email, raw_app_meta_data ->> 'role' as role
--        from auth.users
--       where raw_app_meta_data ->> 'role' is not null;
--
-- 3. No student has one. Expect zero rows:
--      select u.id, u.email
--        from auth.users u
--       where u.raw_app_meta_data ->> 'role' is not null
--         and exists (select 1 from public.bookings b where b.user_id = u.id);
-- ─────────────────────────────────────────────────────────────────────────
