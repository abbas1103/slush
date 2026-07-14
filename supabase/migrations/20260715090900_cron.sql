-- ─────────────────────────────────────────────────────────────────────────
-- Scheduled hygiene. Correctness of the hold/capacity logic never depends on
-- this firing (expiry is also handled lazily inside start_booking + finalise);
-- pg_cron just keeps the holds table tidy and pending bookings swept.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;

-- every minute: expire stale holds + cancel abandoned pending bookings
select cron.schedule(
  'expire-stale-holds',
  '* * * * *',
  $$ select public.expire_stale_holds(); $$
);
