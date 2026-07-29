# SLUSH - Production deploy runbook

Go-live checklist for the Brumski trip. **Keep Stripe in test mode until the owner is ready to
take real money.** Live Stripe keys are added **only in Vercel Production, only by the owner.**

> Order matters: provision the backing services first, set env vars, deploy, then verify.

---

## 1. Supabase (production project - separate from dev)

- [ ] Create a **new, EU-region** Supabase project (prod ≠ dev). Note the project ref.
- [ ] Apply migrations to prod:
      `npx supabase db push --db-url "$PROD_DB_URL"` (all files in `supabase/migrations/`, in
      filename order). The audit remediation adds three, and they must all land:
      `20260729000100_fix_function_grants.sql` (revokes EXECUTE on the money/capacity RPCs from
      `anon` + `authenticated`, and revokes the default privileges that re-granted it),
      `20260729000200_fix_finalize_and_holds.sql` (the ledger/placement order, the
      `bookings.base_price_at_booking` snapshot, the reconciliation queue) and
      `20260729000300_rls_mfa_and_constraints.sql` (RLS/MFA policies, the confirmed_count guard).
      CI already proves the whole set replays onto an empty database from scratch.
- [ ] **Verify the grants landed** (this is the critical one - a stale grant means a fully paid
      place for £0). Expect **zero rows**:

  ```sql
  select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) as r(rolname)
   where n.nspname = 'public'
     and p.proname in ('record_payment_and_finalize', 'admin_convert_booking',
                       'expire_stale_holds', 'compute_trip_cost', 'booking_trip_paid',
                       'booking_balance', 'generate_booking_reference')
     and has_function_privilege(r.rolname, p.oid, 'execute');
  ```

      The header of `supabase/migrations/20260729000100_fix_function_grants.sql` carries three more
      verification queries (default privileges, the `trip_availability` read model, and a check for
      fabricated `payments` rows). Run all four before taking money.
- [ ] Confirm the hold sweep is scheduled: `select jobname, schedule, active from cron.job;` should
      list `expire-stale-holds` every minute. Capacity correctness does not depend on it (expiry is
      also lazy), but without it stale holds sit on places for 30 minutes longer than they should.
- [ ] Load the trip catalogue: run `supabase/seed.sql` against prod (Brumski trip, code, extras/tiers).
      Every insert is `on conflict do nothing`, so re-running it only fills gaps and can never revert
      a CMS edit. **Confirm the equipment prices in the admin CMS**, not in the seed file (the brief
      marks them "confirm before launch").
- [ ] Auth settings: enable **Confirm email** (PKCE), set the **Redirect URL allow-list** to the
      prod domain only (no wildcards), password min ≥10 + **leaked-password protection**, enable
      **TOTP MFA** (Auth → Multi-Factor), enable **Turnstile CAPTCHA**.
- [ ] Enable the **Google** provider (strict same-verified-email linking). Google is the only social
      login the app offers - Apple sign-in was removed, so leave that provider disabled.

### Backups, PITR and a rehearsed restore

This database is the **sole record of who paid what**. Supabase's free daily backup is not enough on
its own, and PITR is a paid add-on that is **off by default**.

- [ ] Confirm **daily backups** are on for the prod project (Database → Backups) and note the
      retention window.
- [ ] Enable **Point-in-Time Recovery** (Database → Backups → PITR). Target **RPO ≤ 5 minutes**
      (a lost booking is a student who paid and has no place) and **RTO ≤ 4 hours**.
- [ ] **Rehearse a restore before go-live**, once: restore the latest backup into a scratch project,
      then check `select count(*), sum(amount) from payments;` and
      `select id, capacity, confirmed_count from trips;` against the source. A backup nobody has
      restored is not a backup. Write the date of the rehearsal here: ______
- [ ] Before any migration on prod: take an on-demand backup, note the timestamp to recover to, and
      keep the rollback SQL to hand. Migrations that touch `payments`, `damage_deposits` or
      `trips.confirmed_count` are the ones to be paranoid about.
- [ ] Keep the `PII_ENCRYPTION_KEY` backed up **outside** Supabase and Vercel (a password manager the
      owner controls). A restored database without that key has unreadable passport/DOB/phone data.

## 2. Vercel project

- [ ] Import the repo; framework auto-detected (Next.js). Production branch = `main`.
- [ ] Set the **environment variables** (Production + Preview as noted):

  **Public (non-secret, `NEXT_PUBLIC_`):**
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test in Preview; **live in Production, owner-only**)
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  - `NEXT_PUBLIC_SENTRY_DSN` (publishable)

  **Secret (server-only):**
  - `SUPABASE_SECRET_KEY` (service role) - never `NEXT_PUBLIC_`
  - `STRIPE_SECRET_KEY` (`sk_test_` in Preview; **`sk_live_` in Production, owner-only**)
  - `STRIPE_WEBHOOK_SECRET` (from step 3)
  - `PII_ENCRYPTION_KEY` (32-byte base64 - **reuse the exact key used to encrypt existing rows;
    losing/rotating it makes passport/DOB/phone/emergency unreadable**)
  - `TURNSTILE_SECRET_KEY`
  - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (activates rate limiting)
  - `CRON_SECRET` (random; Vercel Cron auto-sends it as `Authorization: Bearer`)
  - `SENTRY_DSN`, and build-time `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`
  - `CRM_PROVIDER` - leave blank until a CRM is chosen. The drain then stays inert and leaves every
    event queued, so nothing is lost. For Zoho set `CRM_PROVIDER=zoho` plus `ZOHO_CLIENT_ID`,
    `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` and `ZOHO_ACCOUNTS_URL` (the data centre, e.g.
    `https://accounts.zoho.eu`). See `lib/crm/adapters.ts`.
- [ ] Region: `vercel.json` pins `fra1` (EU) to sit near the EU Supabase project.

## 3. Stripe (test throughout build; live only at go-live, by owner)

- [ ] Add a **webhook endpoint** → `https://<prod-domain>/api/stripe/webhook`, events:
      `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`,
      `charge.dispute.created`. Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
- [ ] Owner adds **live** `sk_live_` / `pk_live_` in Production env only, at go-live.
- [ ] Flag to owner: the **£100 damage deposit is charge-then-refund** (captured up front, refunded
      after the trip), not a manual-capture hold.

## 4. Sentry (error tracking, PII-scrubbed)

- [ ] Create an **EU-region** Sentry project. Set the DSN vars (step 2).
- [ ] Wiring is already done and **env-gated** - with no DSN it's fully inert. Browser events
      tunnel same-origin via `/monitoring` (no CSP change needed). Session Replay is intentionally
      **off** (would record passport/DOB/card fields). `sendDefaultPii:false` + a `beforeSend`
      scrubber strip request bodies/cookies/headers/query strings.
- [ ] For source-map upload set `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (build-time).
      Without the auth token the build still succeeds (upload skipped).

## 5. Cron (CRM outbox drain)

- [ ] `vercel.json` schedules `/api/cron/crm` **once a day at 03:00**, because **sub-daily crons need
      Vercel Pro** (Hobby = once daily). On Pro, change it to `*/15 * * * *`.
- [ ] Throughput: one run drains up to **500 events** within an ~8s wall-clock budget, so a sold-out
      300-place trip clears in a single night. Rows are taken fewest-attempts-first, so a row that
      keeps failing sinks behind fresh events instead of blocking the queue. Anything left over stays
      queued for the next run - nothing is dropped.
- [ ] On Pro, or once a real CRM adapter is doing HTTP work per event, add
      `export const maxDuration = 60` to `app/api/cron/crm/route.ts` and raise the drain's budget;
      without it Vercel's default 10s limit is the binding constraint.
- [ ] With `CRM_PROVIDER` blank the drain **does nothing on purpose**: it logs
      `[crm] adapter 'log' delivers nothing - leaving N event(s) queued` and leaves the rows
      `pending`, so the whole history syncs the day a CRM is configured. Watch that `N` - a number
      that only grows after a CRM *is* configured means events are not being delivered.
- [ ] The route rejects anything without `Authorization: Bearer $CRON_SECRET`, so `CRON_SECRET`
      must be set for the cron to succeed. A run that cannot query the outbox, or where every event
      failed, now returns **5xx** so the Vercel cron log shows red and Sentry sees it.

## 6. Admin access + MFA (operational control)

- [ ] Grant `admin` only when the person can **enrol their authenticator immediately** in a trusted
      session (a stolen password for a not-yet-enrolled admin could bootstrap MFA - see `CLAUDE.md`).
      SQL: `update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) ||
      '{"role":"admin"}'::jsonb where email='<owner-email>';` then log out/in.
- [ ] First `/admin` visit → `/admin/security` → scan QR → verified (aal2). Recovery from a lost
      device = owner unenrols the factor via the service-role admin API.

## 7. Post-deploy smoke checks

- [ ] `curl -sI https://<domain> | grep -i content-security-policy` → has `'nonce-…'`, **no
      `'unsafe-inline'`** in `script-src`; app + Stripe Payment Element render.
- [ ] `curl -sI https://<domain> | grep -i permissions-policy` → `payment` is delegated to
      `self "https://js.stripe.com"`, otherwise the browser blocks the wallet buttons inside
      Stripe's iframe and every student is dropped to manual card entry.
- [ ] Full booking on a **real phone** (iOS Safari + Android Chrome), incl. the 3DS/SCA challenge:
      deposit → confirmed; balance → cleared → tickets unlock (QR); pay-in-full.
- [ ] Trigger a test webhook and confirm the ledger writes; confirm the cron runs (check logs).
- [ ] Cron auth: `curl -si https://<domain>/api/cron/crm` → **401**;
      `curl -si -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/crm` → **200**
      with a JSON drain summary.
- [ ] Re-run the grant-verification query from step 1 **against production** after the first deploy.
- [ ] Map every check to brief **§11**.

## 8. Before taking REAL money (legal - brief §12)

- [ ] **Package Travel Regs 2018**: insolvency/financial protection - get legal advice.
- [ ] Publish versioned Booking Conditions / Refund Policy / Trip Terms + a real privacy notice;
      store accepted version + timestamp (the `consents` table already supports this).
- [ ] `npm audit --omit=dev` - production dependencies currently report **3 high advisories, all
      transitive through Next and none with a forward fix on Next 16.x** (npm's only offered "fix" is
      downgrading `next` to 9.3.3): `postcss` (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q,
      GHSA-r28c-9q8g-f849, all build-time) and `sharp` (GHSA-f88m-g3jw-g9cj, image tooling). CI
      allowlists exactly those advisory ids and **fails on any new one**, so this step is a review of
      the allowlist, not a fresh triage: re-check on every Next minor and drop entries as fixes ship.
      Dev-only advisories (the eslint chain) need an eslint 10 major bump and never reach students.

---

**Separation of duties:** dev and prod are separate Supabase projects and separate Stripe
webhook endpoints/secrets. **Live Stripe keys never leave Vercel Production and are added only by
the owner.**
