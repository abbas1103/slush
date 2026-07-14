-- ─────────────────────────────────────────────────────────────────────────
-- Authorization helper functions used by RLS policies.
-- All are STABLE with an empty search_path (schema-qualify everything) to
-- prevent search-path hijacking.
-- ─────────────────────────────────────────────────────────────────────────

-- Is the current request an admin? Role lives in the JWT app_metadata (not
-- self-settable by users), so this needs no table lookup and can't recurse.
create or replace function public.is_admin()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- Admin AND has completed MFA (assurance level aal2). Used to gate admin writes
-- that touch money or PII.
create or replace function public.is_admin_mfa()
returns boolean
language sql stable
set search_path = ''
as $$
  select public.is_admin() and coalesce((auth.jwt() ->> 'aal') = 'aal2', false);
$$;

-- Is a trip publicly bookable? SECURITY DEFINER so RLS policies on extras /
-- extra_tiers can check trip status without triggering nested RLS on trips.
create or replace function public.trip_is_public(p_trip_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trips where id = p_trip_id and status = 'live'
  );
$$;

-- Is an extra publicly visible (active, on a live trip)?
create or replace function public.extra_is_public(p_extra_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.extras e
    join public.trips t on t.id = e.trip_id
    where e.id = p_extra_id and e.active and t.status = 'live'
  );
$$;
