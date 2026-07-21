# SLUSH - project context for Claude Code

SLUSH is a **production** booking-and-payments web app for student ski trips. It handles **real money
and sensitive student PII**, so the bar is industry-standard or better on security and correctness.
The first trip is the **Brumski Christmas Trip** (Alpe d'Huez, Sat 12–19 Dec 2026).

- **Source of truth for data/logic:** `slush-build-brief.md`.
- **Visual/behavioural reference:** `slush-booking-prototype.html` (match its screens, copy, flow).
  Where they differ, the brief wins.
- **Full build plan:** `~/.claude/plans/you-are-an-experienced-playful-volcano.md`.

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase (Postgres + Auth + RLS, EU region) ·
Stripe (Payment Element + PaymentIntents, **test mode throughout the build**) · Tailwind v4 · Vercel.
Note: middleware lives in `proxy.ts` (Next 16's renamed `middleware.ts`).

## Non-negotiables

- **The database is the source of truth for money and capacity.** Never trust prices/amounts from the
  browser - recompute every total server-side from DB rows before charging.
- **Money is integer pence everywhere** (DB, pricing, Stripe). No floats/decimals for currency.
- **Financial rows (`payments`, `damage_deposits`) are written ONLY from the verified Stripe webhook**
  (service-role client), never from client callbacks. Idempotent on Stripe `event.id`.
- **RLS on every table; deny by default.** Students read/write only their own rows. The Supabase
  `service_role` key is server-only (`import 'server-only'`) and must never reach the browser.
- **No secrets in code or git.** All keys in `.env.local` (gitignored) / Vercel env vars. Live Stripe
  keys are added only at deploy, by the owner, in Vercel. `NEXT_PUBLIC_*` = non-secret only.
- **PII is sensitive** (passport, DOB, emergency contact, access/medical needs). Encrypt sensitive
  fields at rest (AES-256-GCM, `lib/crypto/pii.ts`), never log PII, never put it in URLs, minimise retention.
- **Everything admins edit is data, not hardcoded** (trips, prices, extras, capacity, codes, terms).
- **Authorise on `supabase.auth.getUser()`** (verifies the JWT), never `getSession()`. Re-check auth
  inside every server action - never rely on middleware alone.
- **Admin MFA (TOTP) is self-enrolled on first login.** Grant the `admin` role only when the person is
  ready to enrol their authenticator **immediately, in a trusted session** - a stolen password for a
  not-yet-enrolled admin could otherwise bootstrap the second factor. Once enrolled, password-only never
  reaches the CMS. (No clean code fix for first-factor bootstrap; this is an operational control.)
- **Validate every input** with Zod `.strict()` at each server-action / route boundary; never accept
  `status` or `price` from the client.
- **Use Plan Mode** for anything touching auth, payments, or the schema.

## Money model (precise)

- Trip cost **C** = `base_price` + Σ(selected extras). All extras (coach, equipment tiers, lessons,
  events, winter-sports cover £42) are DB rows.
- **Deposit £150 = £50 downpayment (reduces trip balance) + £100 refundable damage deposit (held
  separately).** After deposit, `balance = C − 50`. (C=£439 → balance £389, £100 held.)
- **Pay in full = C + £100 today**; balance → £0.
- Damage deposit is **charge-then-refund** (a manual-capture auth expires ~7 days; the trip is months
  out), refunded after the trip by admin. Waitlist refund returns the full £150 (incl. the £50).

## Capacity & the 30-min hold

- `holds` table is the server-side truth for the 30-min reservation; expiry is lazy + swept (pg_cron).
- The confirmed-vs-waitlisted decision is made **atomically at payment success** in
  `finalize_booking()` under `SELECT … FROM trips WHERE id FOR UPDATE` - never exceed capacity (never 301).

## Build discipline

- **One slice per session, a new git branch per slice** (see the plan's build order). Keep Stripe in
  test mode the entire build. Get the **data model signed off** before building on it.
- Verify each slice end-to-end (run the app, not just tests); map to the brief's Section 11 checklist.

## Commands

- `npm run dev` - dev server · `npm run build` - production build · `npm run lint` - eslint
- `npm test` - unit tests (Vitest) · `npx supabase start` - local Postgres+Auth (Docker)
- `npx supabase db reset` - re-run migrations + seed · `npx supabase gen types typescript` - DB types
