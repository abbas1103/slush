# SLUSH - environment keys: setup & handover guide

How to obtain and set every environment variable SLUSH needs. Pair this with
[`.env.example`](.env.example) (the full list) and [`DEPLOY.md`](DEPLOY.md) (the go-live runbook).

**This file contains no secrets and never should.** It explains where to get each value; the values
themselves live only in `.env.local` (local, gitignored) and Vercel's env settings.

---

## How env vars work here

- **Local dev:** copy `.env.example` to `.env.local` and fill it in. `.env.local` is gitignored.
- **Deployed (Vercel):** set the same vars in Project → Settings → Environment Variables.
- **`NEXT_PUBLIC_` = shipped to the browser.** Put only non-secret values there. Everything without
  that prefix is server-only and must never get a `NEXT_PUBLIC_` prefix.
- **Test vs live:** the whole app runs in **Stripe test mode** until go-live. Only Stripe truly has a
  test/live split; the owner swaps to live keys in Vercel Production at go-live (see `DEPLOY.md`).

## At a glance

| Variable | Service | Secret? | Needed to run locally? | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | - | no | yes | Base URL of the app |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | no | yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase | no | yes | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | Supabase | **yes** | yes | `sb_secret_…`, bypasses RLS |
| `PII_ENCRYPTION_KEY` | (generated) | **yes** | yes | Rotate only via the procedure below |
| `PII_ENCRYPTION_KEY_RETIRED` | (generated) | **yes** | no | Previous keys, comma-separated - reads only |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe | no | yes | `pk_test_…` |
| `STRIPE_SECRET_KEY` | Stripe | **yes** | yes | `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | Stripe | **yes** | for payments | `whsec_…` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare | no | optional | CAPTCHA site key |
| `TURNSTILE_SECRET_KEY` | Cloudflare | **yes** | optional | CAPTCHA secret |
| `UPSTASH_REDIS_REST_URL` | Upstash | no | optional | Rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash | **yes** | optional | Rate limiting |
| `SENTRY_DSN` | Sentry | no | optional | Server-side only; inert if unset |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Sentry | no | no | Build-time (source maps) |
| `SENTRY_AUTH_TOKEN` | Sentry | **yes** | no | Build-time only |
| `CRM_PROVIDER` | - | no | optional | `zoho` or blank |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` | Zoho | **yes** | optional | OAuth app |
| `ZOHO_REFRESH_TOKEN` | Zoho | **yes** | optional | Long-lived token |
| `ZOHO_ACCOUNTS_URL` | Zoho | no | optional | Data-centre accounts domain |
| `CRON_SECRET` | (generated) | **yes** | no | Protects the CRM cron route |

"Optional to run locally" = the app boots and the core booking/payment flow works without it; that
feature is simply inactive (Sentry inert, no rate limiting, no CRM sync).

---

## 1. Site URL - `NEXT_PUBLIC_SITE_URL`

The app's base URL. Used for OAuth redirects and absolute links.

- **Local:** `http://localhost:3000` (or `:3001` if 3000 is taken).
- **Deployed:** the production domain, e.g. `https://slush-iota.vercel.app` or the custom domain.
- This must match the **Supabase redirect allow-list** (see Supabase auth), or Google sign-in breaks.

## 2. Supabase - URL + two keys

Dashboard: <https://supabase.com/dashboard> → your project → **Project Settings → API Keys** (and
**Data API** for the URL).

- `NEXT_PUBLIC_SUPABASE_URL` - the **Project URL** (`https://<ref>.supabase.co`).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - the **publishable** key (`sb_publishable_…`). Safe in the
  browser; RLS still applies.
- `SUPABASE_SECRET_KEY` - the **secret** key (`sb_secret_…`). **Bypasses RLS - server-only, never
  `NEXT_PUBLIC_`.** Used by the webhook, admin actions, and privileged jobs.

Auth setup (Dashboard → Authentication): add every `NEXT_PUBLIC_SITE_URL` you use to the **Redirect
URLs** allow-list (local + deployed), enable **Confirm email** for real launch, enable **TOTP MFA**
(Auth → Multi-Factor) for admins, and enable **Google** as a social provider. (Apple was removed;
SLUSH is Google-only.)

## 3. PII encryption key - `PII_ENCRYPTION_KEY`

Encrypts passport, DOB, phone, and emergency-contact fields at rest (AES-256-GCM). Generate a
32-byte base64 key:

```
openssl rand -base64 32
```

> **Critical:** this key is not "obtained" from a service, it is generated once and kept. If it is
> lost after data has been written, every encrypted field becomes **permanently unreadable**. On
> handover it must travel with the database.

### Rotating it - `PII_ENCRYPTION_KEY_RETIRED`

Rotation is supported, but only through this procedure. Writes always use `PII_ENCRYPTION_KEY`;
reads try it first and then each key in `PII_ENCRYPTION_KEY_RETIRED` (comma-separated base64), so
rows written under an older key stay readable while the new one rolls out.

1. Generate the new key: `openssl rand -base64 32`.
2. Move the **current** value into `PII_ENCRYPTION_KEY_RETIRED` (append with a comma if it already
   has entries), and put the new key in `PII_ENCRYPTION_KEY`. Set both in the same Vercel save so no
   deployment ever runs with the new key and no retired one.
3. Deploy. Existing rows read via the retired key; anything written from now on uses the new key.
4. Re-encrypt: every student who saves their details is migrated automatically, but rows nobody
   touches stay on the old key. Until they are re-encrypted, the retired key must remain set.
5. Only remove the retired key once you have confirmed no row still needs it.

> Setting `PII_ENCRYPTION_KEY` to a new value **without** carrying the old one into
> `PII_ENCRYPTION_KEY_RETIRED` makes every existing passport number, DOB, phone and access-needs
> field unreadable. `decryptPII` returns null for a value it cannot open and raises a Sentry error
> ("could not open a well-formed v1 value under any key") - if you see that after a key change, stop
> and restore the old key before anyone saves a form, because a save overwrites the ciphertext.

## 4. Stripe - publishable, secret, webhook

Dashboard: <https://dashboard.stripe.com> → **Developers → API keys** (make sure the **Test mode**
toggle is on to get test keys).

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - the **Publishable key** (`pk_test_…`).
- `STRIPE_SECRET_KEY` - the **Secret key** (`sk_test_…`). Server-only.
- `STRIPE_WEBHOOK_SECRET` - the webhook signing secret (`whsec_…`):
  - **Local:** run `stripe listen --forward-to localhost:3001/api/stripe/webhook`; the CLI prints a
    `whsec_…` for the session.
  - **Deployed:** Developers → Webhooks → add endpoint `https://<domain>/api/stripe/webhook`, select
    `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`,
    `charge.dispute.created`, then reveal the signing secret.

**Live keys (`sk_live_`/`pk_live_`) are added only in Vercel Production, only by the owner, at go-live.**

## 5. Cloudflare Turnstile - CAPTCHA (optional locally)

Dashboard: <https://dash.cloudflare.com> → **Turnstile** → add a site.

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` - the **Site Key** (public).
- `TURNSTILE_SECRET_KEY` - the **Secret Key** (server-only).
- Add each domain you use (localhost for dev, the prod domain for prod).
- **Local shortcut:** Cloudflare's always-passing test keys let you skip real setup while developing -
  site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

## 6. Upstash Redis - rate limiting (optional locally)

Console: <https://console.upstash.com> → create a **Redis** database (pick an **EU** region) → open
the **REST API** section.

- `UPSTASH_REDIS_REST_URL` - the REST URL.
- `UPSTASH_REDIS_REST_TOKEN` - the REST token (server-only).

Without these, rate limiting on login / trip-code / payment is simply inactive locally.

## 7. Sentry - error tracking (optional locally)

Dashboard: <https://sentry.io> → create a **Next.js** project (an **EU-region** org is preferred for
UK PII).

- `SENTRY_DSN` - the **DSN** (Project Settings → Client Keys). Publishable, not secret. Server-side
  only; there is no `NEXT_PUBLIC_SENTRY_DSN` because there is no browser SDK (client errors are
  posted to `/api/client-error` and reported from the server).
- `SENTRY_ORG` / `SENTRY_PROJECT` - the org and project slugs (from the URL or settings). Build-time
  only, for source-map upload.
- `SENTRY_AUTH_TOKEN` - an auth token (Settings → Auth Tokens) with source-map upload scope.
  **Secret**, build-time only, set in CI/Vercel. Sentry is fully inert with no DSN.

## 8. Zoho CRM - contact + booking sync (optional)

Only needed when `CRM_PROVIDER=zoho`. Leave `CRM_PROVIDER` blank and the app uses the inert log
adapter (no external calls). `CRM_API_KEY` / `CRM_BASE_URL` are for other providers and are ignored
by Zoho. What the app does once configured: on each cron drain it upserts every booker as a Zoho
**Contact** (deduped on email) and each booking as a Zoho **Deal** (deduped on the `BRUM-26-…`
reference), sending only contact basics + booking summary (never passport/DOB/medical).

### Step 0 - find your data centre (DC)

Zoho is region-siloed. Whatever domain you log into Zoho at is your DC, and the API console, accounts
URL, and API domain must ALL use that same region. Get this wrong and every call fails.

| You log in at | DC suffix | Accounts URL (`ZOHO_ACCOUNTS_URL`) |
|---|---|---|
| crm.zoho.com | `.com` | `https://accounts.zoho.com` |
| crm.zoho.eu | `.eu` | `https://accounts.zoho.eu` |
| crm.zoho.com.au | `.com.au` | `https://accounts.zoho.com.au` |
| crm.zoho.in | `.in` | `https://accounts.zoho.in` |
| crm.zoho.jp | `.jp` | `https://accounts.zoho.jp` |
| crm.zoho.ca | `.ca` | `https://accounts.zoho.ca` |

### Step 1 - create a Self Client (gives Client ID + Secret)

1. Sign in to the **Zoho API Console** at `https://api-console.zoho.<dc>` with the account that owns
   the CRM.
2. **Add Client → Self Client** (Self Client is for server-to-server apps, no redirect URI needed) →
   **Create / OK**.
3. Open the **Client Secret** tab and copy:
   - **Client ID** → `ZOHO_CLIENT_ID` (looks like `1000.XXXXXXXX`)
   - **Client Secret** → `ZOHO_CLIENT_SECRET`

### Step 2 - generate a grant code

1. In the same Self Client, open the **Generate Code** tab.
2. **Scope:** `ZohoCRM.modules.ALL` (this covers creating Contacts and Deals).
3. **Time Duration:** 10 minutes is plenty. **Scope Description:** anything, e.g. `SLUSH sync`.
4. **Create** → copy the generated **grant code**. It is single-use and expires within the window you
   picked, so do Step 3 straight away.

### Step 3 - exchange the grant code for a refresh token

Run this within the code's expiry window (substitute your DC and values):

```
curl -X POST "https://accounts.zoho.<dc>/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=<CLIENT_ID>" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "code=<GRANT_CODE>"
```

The JSON response contains a `refresh_token` (long-lived) and an `access_token` (short-lived). You
only need the **refresh_token** → `ZOHO_REFRESH_TOKEN`. The app mints its own access tokens from it,
and reads the API domain from Zoho's own response, so you do not set an API domain.

Gotchas:
- The grant code works **once**. `invalid_code` = expired or already used; regenerate in Step 2.
- Zoho caps refresh tokens per client (about 20). Reuse the one you generate; don't loop.
- If you ever see `invalid_client`, the Client ID/Secret don't match the DC in the URL.

### Step 4 - set the env vars

```
CRM_PROVIDER=zoho
ZOHO_CLIENT_ID=1000.xxxxxxxx
ZOHO_CLIENT_SECRET=xxxxxxxx
ZOHO_REFRESH_TOKEN=1000.xxxxxxxx.yyyyyyyy
ZOHO_ACCOUNTS_URL=https://accounts.zoho.<dc>
```

Locally in `.env.local`; on deploy in Vercel env (all four are secret except the accounts URL).

### Step 5 - verify

Trigger the drain (or wait for the daily cron) and confirm a Contact appears in Zoho:

```
curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/crm
```

A response like `{"total":N,"sent":N,"failed":0}` means it worked. Any `failed` rows record the Zoho
error in the `crm_outbox` table's `last_error`.

### The one decision: Deal Stage names

The adapter maps SLUSH booking status to a Zoho Deal **Stage** using Zoho's default stage names
(e.g. confirmed → "Closed Won"). Zoho **rejects a Stage that doesn't exist** in your pipeline. If the
Slush CRM uses a custom sales pipeline, send the actual stage names to the developer so `STAGE_MAP` in
[`lib/crm/adapters.ts`](lib/crm/adapters.ts) matches. Contacts always sync regardless; only the
booking-as-Deal push depends on this.

## 9. Cron secret - `CRON_SECRET`

Protects the CRM outbox drain route (`/api/cron/crm`). Generate any random string:

```
openssl rand -hex 32
```

Set the same value in Vercel; Vercel Cron automatically sends it as `Authorization: Bearer <value>`.

---

## Minimum to boot the app locally

Fill just these in `.env.local` and the booking + payment flow works end to end:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- `PII_ENCRYPTION_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- (Turnstile test keys from section 5 if you want the CAPTCHA to pass)

Sentry, Upstash, and Zoho can stay blank locally.

---

## Handover / rotation checklist

When SLUSH transfers to the owner's accounts, treat this as the "rotate/migrate" list:

- **Supabase:** transfer the project into the owner's org (or recreate + migrate). Reissue
  `SUPABASE_SECRET_KEY` and the publishable key if the project moves; update the URL if the ref changes.
- **`PII_ENCRYPTION_KEY`:** **carry the exact same value across** with the database. Rotating it
  orphans all encrypted PII. If you ever must rotate, do a decrypt-with-old / re-encrypt-with-new pass first.
- **Stripe:** the owner creates/owns the Stripe account and adds `sk_live_`/`pk_live_` in Vercel
  Production; register the production webhook and update `STRIPE_WEBHOOK_SECRET`.
- **Turnstile / Upstash / Sentry / Zoho:** recreate under the owner's accounts and swap the keys; none
  hold irreplaceable data.
- **`CRON_SECRET`:** regenerate on transfer.
- After any change, redeploy so Vercel picks up the new values, then smoke-test login, a deposit, and
  a webhook delivery.
