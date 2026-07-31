-- ─────────────────────────────────────────────────────────────────────────
-- Rate limiting in Postgres, replacing Upstash Redis.
--
-- The Upstash-backed limiter was never configured (UPSTASH_REDIS_REST_URL and
-- _TOKEN were blank in every environment), and `lib/ratelimit.ts` returns true
-- when unconfigured - so every check has been passing, in dev and in
-- production, since it was written. This makes the limiter real using the
-- database we already run, with no extra vendor, no extra secret to leak and
-- no extra thing to be down.
--
-- WHY POSTGRES IS ENOUGH HERE: a sliding-window log costs one round trip and at
-- most `limit` rows per bucket per window. Our tightest limit is 20/min, so a
-- bucket holds ≤20 rows. The trade-off is that limiter writes land on the same
-- database the limiter protects, which matters at thousands of requests per
-- second; a 300-place trip with a release-day burst is orders of magnitude
-- below that. If throughput ever changes that calculus, move this to the edge
-- (a WAF rule) rather than to another datastore - blocking before the request
-- reaches compute is the only version that actually saves anything.
--
-- SERVICE-ROLE ONLY, deliberately. `p_bucket` is a caller-supplied string, so a
-- role that can execute this can burn ANY bucket - including another student's.
-- Granting it to `authenticated` would hand every logged-in user a griefing
-- primitive that locks a chosen victim out of booking. The server passes the
-- bucket; the browser never reaches this.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.rate_limit_hits (
  id      bigserial   primary key,
  -- '<kind>:<id>', e.g. 'tripCode:203.0.113.7' or 'payment:<uuid>'.
  bucket  text        not null,
  hit_at  timestamptz not null default now()
);

-- Serves both the count and the prune; descending because the window is always
-- "recent rows".
create index if not exists rate_limit_hits_bucket_time
  on public.rate_limit_hits (bucket, hit_at desc);

alter table public.rate_limit_hits enable row level security;
-- No policies, and no table grants: RLS-on with zero policies denies every
-- client role outright, and service_role bypasses RLS.
revoke all on table public.rate_limit_hits from anon, authenticated;

/**
 * Returns true if this call is ALLOWED, false if it should be refused.
 *
 * Sliding-window log: counts hits inside the window and records the current one
 * only when it is allowed. Refusals are deliberately NOT recorded - otherwise a
 * client hammering the endpoint keeps pushing its own window forward and stays
 * locked out long after it stopped, which turns a rate limit into a ban.
 */
create or replace function public.rate_limit_check(
  p_bucket text,
  p_limit  int,
  p_window interval
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz := now() - p_window;
  v_count  int;
begin
  if p_bucket is null or length(p_bucket) = 0 or p_limit is null or p_limit <= 0 then
    return false;
  end if;

  -- Without this, two concurrent requests can both read a count below the limit
  -- and both insert, so the limit leaks upward under exactly the load it exists
  -- to control. Transaction-scoped (released on commit) and keyed per bucket, so
  -- unrelated callers never contend.
  perform pg_advisory_xact_lock(hashtext(p_bucket));

  -- Housekeeping scoped to this bucket: keeps a hot bucket bounded without any
  -- single call scanning the table. The pg_cron sweep below handles buckets that
  -- go quiet and are never asked about again.
  delete from public.rate_limit_hits
   where bucket = p_bucket
     and hit_at < v_cutoff;

  select count(*) into v_count
    from public.rate_limit_hits
   where bucket = p_bucket;

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.rate_limit_hits (bucket) values (p_bucket);
  return true;
end;
$$;

revoke all    on function public.rate_limit_check(text, int, interval) from public, anon, authenticated;
grant  execute on function public.rate_limit_check(text, int, interval) to service_role;

-- Abandoned buckets: the in-function prune only touches buckets that get asked
-- about again, so a one-off burst from an IP that never returns would linger.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sweep-rate-limits') then
    perform cron.unschedule('sweep-rate-limits');
  end if;
  perform cron.schedule(
    'sweep-rate-limits',
    '*/15 * * * *',
    $sweep$ delete from public.rate_limit_hits where hit_at < now() - interval '1 hour'; $sweep$
  );
end
$$;
