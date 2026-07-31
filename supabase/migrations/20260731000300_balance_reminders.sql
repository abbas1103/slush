-- ─────────────────────────────────────────────────────────────────────────
-- Who owes money, and when. `trips.balance_due_date` has existed since the first
-- migration and nothing has ever read it, so chasing balances was a manual job.
--
-- The money stays in the database: this calls public.booking_balance() rather
-- than re-deriving cost-minus-paid in TypeScript, because a second implementation
-- of "what does this student owe" would eventually disagree with the first, and
-- the disagreement would be an email telling someone the wrong number.
--
-- Exact-day matching, not a range: the caller runs daily and each stage must fire
-- once. A range would re-select the same booking every day until the due date,
-- and while the outbox dedupe key would swallow the repeats, relying on that
-- would mean the query is wrong and something else is covering for it.
--
-- service_role only, like the other privileged helpers: it returns balances
-- across every booking, which no client should ever be able to enumerate.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.bookings_due_balance(p_days int)
returns table (booking_id uuid, balance int, due_date date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, bal.v, t.balance_due_date
    from public.bookings b
    join public.trips t on t.id = b.trip_id
    -- Lateral so booking_balance() is evaluated once per row rather than once
    -- in the select list and again in the where clause.
    cross join lateral (select public.booking_balance(b.id) as v) bal
   where b.status in ('confirmed', 'converted')
     and t.balance_due_date is not null
     and t.balance_due_date = current_date + p_days
     and bal.v > 0
$$;

revoke all     on function public.bookings_due_balance(int) from public, anon, authenticated;
grant  execute on function public.bookings_due_balance(int) to service_role;
