-- ─────────────────────────────────────────────────────────────────────────
-- Transactional email: a durable outbox.
--
-- Same shape as crm_outbox, with one difference that drives the whole design:
-- a CRM sync is idempotent because the adapter upserts by reference, but a sent
-- email CANNOT BE UNSENT. Stripe retries a webhook delivery for up to three
-- days, so "send inline from the handler" means a student gets four identical
-- receipts for one £150 payment. Receipts for real money are exactly the wrong
-- thing to duplicate.
--
-- `dedupe_key` is therefore UNIQUE and callers insert with `on conflict do
-- nothing`. The key is derived from the thing that caused the email (usually the
-- Stripe event id), so a retry enqueues nothing at all rather than relying on the
-- sender to notice.
--
-- Durable rather than fire-and-forget: the row is written first and drained
-- after, so a crash between "took the money" and "told the student" leaves work
-- to retry instead of silence. The drain runs inline for immediacy and again on
-- the nightly cron as the retry net.
-- ─────────────────────────────────────────────────────────────────────────

create type email_outbox_status as enum ('pending', 'sent', 'failed');

create table if not exists public.email_outbox (
  id          uuid primary key default gen_random_uuid(),
  -- e.g. 'receipt:evt_1abc…' or 'promoted:<booking_id>'. UNIQUE is the guard.
  dedupe_key  text not null unique,
  to_email    text not null,
  template    text not null,
  -- Rendered from this, so a template change never rewrites history.
  payload     jsonb not null default '{}'::jsonb,
  status      email_outbox_status not null default 'pending',
  attempts    int not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- Drains take fewest-attempts-first so a permanently failing row sinks behind
-- fresh mail instead of blocking the queue head.
create index if not exists email_outbox_pending_idx
  on public.email_outbox (attempts, created_at)
  where status in ('pending', 'failed');

alter table public.email_outbox enable row level security;

-- Deny by default. The payload carries names and booking details, so students
-- must never read this table; admins get read-only visibility for support.
revoke all on table public.email_outbox from anon, authenticated;
grant select on public.email_outbox to authenticated;
create policy email_outbox_admin_read on public.email_outbox
  for select to authenticated using (public.is_admin());
