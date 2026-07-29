-- ─────────────────────────────────────────────────────────────────────────
-- Ticket tokens + an append-only scan log.
--
-- REPLACES the self-contained HMAC token in lib/tickets.ts. That design signed
-- `bookingId.ticketId.exp` so a scanner could verify offline - but a signature
-- proves only that WE ISSUED IT. It cannot say the booking is still entitled
-- (a refunded student's token stays cryptographically valid for ever) nor that
-- the ticket has already been used. Both answers live in the database, so the
-- scanner has to query anyway, and offline verification would mean putting the
-- signing key on a rep's phone - one lost phone forging every ticket we ever
-- issue. The HMAC was buying nothing it was paying for.
--
-- An opaque random token in a row is strictly better here: revocable (set
-- revoked_at), rotatable per ticket, no key management, no dependency on
-- PII_ENCRYPTION_KEY (whose rotation would otherwise silently invalidate every
-- ticket), and a shorter QR that scans faster off a dim phone screen. 256 bits of
-- randomness makes guessing infeasible, which is what the signature was for.
--
-- THE TOKEN IS NOT A SECRET. It is displayed on a screen in a lift queue and can
-- be photographed. Security rests on WHO MAY RESOLVE IT: staff only. Treat a
-- leaked token as worthless and a leaked staff session as serious.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists ticket_tokens (
  token        text primary key,
  booking_id   uuid not null references bookings(id) on delete cascade,
  -- The human-facing id from deriveTickets (e.g. TKT-LP-0481) and its category.
  ticket_id    text not null,
  ticket_type  text not null,
  title        text not null,
  -- How many times this ticket may legitimately be scanned. A lift pass is 1; a
  -- return coach is 2, because a single boolean 'used' flag would strand every
  -- student on the way home. Set at issuance so the policy travels with the row.
  max_scans    integer not null default 1,
  issued_at    timestamptz not null default now(),
  revoked_at   timestamptz,
  constraint ticket_tokens_max_scans_chk check (max_scans between 1 and 20),
  -- One token per ticket per booking, so re-rendering the tickets page reuses the
  -- row rather than minting a second live QR for the same entitlement.
  constraint ticket_tokens_booking_ticket_uniq unique (booking_id, ticket_id)
);

create index if not exists ticket_tokens_booking_idx on ticket_tokens(booking_id);

-- APPEND-ONLY. Deliberately not a `scanned` boolean on ticket_tokens:
--   * a flag cannot express "coach, outbound and return";
--   * a flag makes a double scan destructive, where a log makes it VISIBLE - the
--     rep sees "scanned 3 minutes ago by Sam" and uses judgement;
--   * inserting needs no atomic claim, so there is no race to get wrong.
-- Failed attempts are recorded too: someone presenting a refunded ticket is
-- exactly what an organiser wants to know about afterwards.
create table if not exists ticket_scans (
  id          uuid primary key default gen_random_uuid(),
  token       text not null references ticket_tokens(token) on delete cascade,
  booking_id  uuid not null references bookings(id) on delete cascade,
  scanned_by  uuid references auth.users(id),
  scanned_at  timestamptz not null default now(),
  -- 'ok' | 'duplicate' | 'not_entitled' | 'revoked'
  result      text not null,
  metadata    jsonb,
  constraint ticket_scans_result_chk
    check (result in ('ok', 'duplicate', 'not_entitled', 'revoked'))
);

create index if not exists ticket_scans_token_idx on ticket_scans(token, scanned_at desc);
create index if not exists ticket_scans_booking_idx on ticket_scans(booking_id);

-- ── RLS: nothing here is client-reachable ──────────────────────────────────
-- Both tables are read and written only by the service-role client (the tickets
-- page issuing a token, the scan action resolving one). A student must not be
-- able to enumerate tokens, and a rep must not be able to browse them - the whole
-- reason the scan surface is safe is that it requires a token you physically
-- hold. No policies, so RLS denies every client role by default.
alter table ticket_tokens enable row level security;
alter table ticket_scans  enable row level security;
revoke all on table ticket_tokens from anon, authenticated;
revoke all on table ticket_scans  from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFICATION - paste into the SQL editor after applying.
--
-- 1. Neither table is reachable from a browser session. Expect false for all:
--      select has_table_privilege('anon', 'public.ticket_tokens', 'select')
--          or has_table_privilege('authenticated', 'public.ticket_tokens', 'select')
--          or has_table_privilege('anon', 'public.ticket_scans', 'select')
--          or has_table_privilege('authenticated', 'public.ticket_scans', 'select');
--
-- 2. RLS is on for both. Expect two rows, both relrowsecurity = true:
--      select relname, relrowsecurity from pg_class
--       where relname in ('ticket_tokens', 'ticket_scans');
--
-- 3. After a trip, who scanned what and what was refused:
--      select s.scanned_at, s.result, t.ticket_id, b.reference, s.scanned_by
--        from ticket_scans s
--        join ticket_tokens t on t.token = s.token
--        join bookings b on b.id = s.booking_id
--       order by s.scanned_at desc;
-- ─────────────────────────────────────────────────────────────────────────
