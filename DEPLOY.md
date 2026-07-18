# SLUSH — Production deploy runbook

Go-live checklist for the Brumski trip. **Keep Stripe in test mode until the owner is ready to
take real money.** Live Stripe keys are added **only in Vercel Production, only by the owner.**

> Order matters: provision the backing services first, set env vars, deploy, then verify.

---

## 1. Supabase (production project — separate from dev)

- [ ] Create a **new, EU-region** Supabase project (prod ≠ dev). Note the project ref.
- [ ] Apply migrations to prod:
      `npx supabase db push --db-url "$PROD_DB_URL"` (all files in `supabase/migrations/`).
- [ ] Load the trip catalogue: run `supabase/seed.sql` against prod (Brumski trip, code, extras/tiers).
      **Confirm the equipment prices** before launch (brief marks them "confirm before launch").
- [ ] Auth settings: enable **Confirm email** (PKCE), set the **Redirect URL allow-list** to the
      prod domain only (no wildcards), password min ≥10 + **leaked-password protection**, enable
      **TOTP MFA** (Auth → Multi-Factor), enable **Turnstile CAPTCHA**.
- [ ] Enable Google + Apple providers (strict same-verified-email linking).

## 2. Vercel project

- [ ] Import the repo; framework auto-detected (Next.js). Production branch = `main`.
- [ ] Set the **environment variables** (Production + Preview as noted):

  **Public (non-secret, `NEXT_PUBLIC_`):**
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test in Preview; **live in Production, owner-only**)
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  - `NEXT_PUBLIC_SENTRY_DSN` (publishable)

  **Secret (server-only):**
  - `SUPABASE_SECRET_KEY` (service role) — never `NEXT_PUBLIC_`
  - `STRIPE_SECRET_KEY` (`sk_test_` in Preview; **`sk_live_` in Production, owner-only**)
  - `STRIPE_WEBHOOK_SECRET` (from step 3)
  - `PII_ENCRYPTION_KEY` (32-byte base64 — **reuse the exact key used to encrypt existing rows;
    losing/rotating it makes passport/DOB/phone/emergency unreadable**)
  - `TURNSTILE_SECRET_KEY`
  - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (activates rate limiting)
  - `CRON_SECRET` (random; Vercel Cron auto-sends it as `Authorization: Bearer`)
  - `SENTRY_DSN`, and build-time `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`
  - `CRM_PROVIDER` / `CRM_API_KEY` / `CRM_BASE_URL` — leave blank until a CRM is chosen (log adapter)
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
- [ ] Wiring is already done and **env-gated** — with no DSN it's fully inert. Browser events
      tunnel same-origin via `/monitoring` (no CSP change needed). Session Replay is intentionally
      **off** (would record passport/DOB/card fields). `sendDefaultPii:false` + a `beforeSend`
      scrubber strip request bodies/cookies/headers/query strings.
- [ ] For source-map upload set `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (build-time).
      Without the auth token the build still succeeds (upload skipped).

## 5. Cron (CRM outbox drain)

- [ ] `vercel.json` schedules `/api/cron/crm` every 15 min. **Sub-daily crons need Vercel Pro**
      (Hobby = once daily). On Hobby, change the schedule to a daily one or upgrade.
- [ ] The route rejects anything without `Authorization: Bearer $CRON_SECRET`, so `CRON_SECRET`
      must be set for the cron to succeed.

## 6. Admin access + MFA (operational control)

- [ ] Grant `admin` only when the person can **enrol their authenticator immediately** in a trusted
      session (a stolen password for a not-yet-enrolled admin could bootstrap MFA — see `CLAUDE.md`).
      SQL: `update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) ||
      '{"role":"admin"}'::jsonb where email='<owner-email>';` then log out/in.
- [ ] First `/admin` visit → `/admin/security` → scan QR → verified (aal2). Recovery from a lost
      device = owner unenrols the factor via the service-role admin API.

## 7. Post-deploy smoke checks

- [ ] `curl -sI https://<domain> | grep -i content-security-policy` → has `'nonce-…'`, **no
      `'unsafe-inline'`** in `script-src`; app + Stripe Payment Element render.
- [ ] Full booking on a **real phone** (iOS Safari + Android Chrome), incl. the 3DS/SCA challenge:
      deposit → confirmed; balance → cleared → tickets unlock (QR); pay-in-full.
- [ ] Trigger a test webhook and confirm the ledger writes; confirm the cron runs (check logs).
- [ ] Map every check to brief **§11**.

## 8. Before taking REAL money (legal — brief §12)

- [ ] **Package Travel Regs 2018**: insolvency/financial protection — get legal advice.
- [ ] Publish versioned Booking Conditions / Refund Policy / Trip Terms + a real privacy notice;
      store accepted version + timestamp (the `consents` table already supports this).
- [ ] `npm audit` — review the 2 moderate advisories introduced with the Sentry SDK; patch if a
      fix is available without breaking changes.

---

**Separation of duties:** dev and prod are separate Supabase projects and separate Stripe
webhook endpoints/secrets. **Live Stripe keys never leave Vercel Production and are added only by
the owner.**
