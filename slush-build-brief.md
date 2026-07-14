# SLUSH — Build Brief & Data Model (v1)

This document is the spec for building the real SLUSH booking app. The clickable
prototype (`slush-booking-prototype.html`, in this folder) is the **visual and
behavioural reference** — match its screens and flow. This brief is the source of
truth for **data, logic and rules**. Where they differ, this brief wins.

---

## 0. Project setup (do this first)

Assumes the project folder already exists at `~/Projects/slush` and Claude Code is
running inside it.

1. Put these two files in the folder: this brief and `slush-booking-prototype.html`.
2. Scaffold the app, then generate project context:
   - Ask Claude Code to scaffold a **Next.js** app (App Router, TypeScript).
   - Run `/init` to create a `CLAUDE.md`, then trim it and paste in the
     "Non-negotiables" section below.
3. First prompt to give Claude Code (in Plan Mode — Shift+Tab twice):

   > Read `slush-build-brief.md` and `slush-booking-prototype.html`. Don't write any
   > code yet. Propose a plan for the data model and project structure only (Section 5
   > of the brief). List the tables, fields and relationships you'd create, and the
   > migration approach with Supabase. Wait for my approval before building anything.

Build **one slice per session** (Section 10). Use a new git branch per slice.
Keep Stripe in **test mode** the entire build.

---

## 1. What we're building

A booking-and-payments web app for student ski trips. SLUSH is the platform/operator;
individual trips are run by university societies (first trip: **Brumski Christmas Trip**,
Alpe d'Huez, Sat 12–19 Dec 2026). Students receive a trip code, view the trip, build a
booking, pay a deposit, and pay off the balance over time. Once paid, tickets unlock.

**Stack:** Next.js (App Router, TS) · Supabase (auth + Postgres) · Stripe (payments) ·
Vercel (hosting). Own database is the source of truth for bookings; CRM sync is a later
slice (Section 9).

---

## 2. Non-negotiables (also put these in CLAUDE.md)

- **Stripe test mode only** during the build. Live keys are added at deploy, by the owner, in Vercel env vars.
- **No secrets in code or git.** All keys (Stripe, Supabase, CRM) live in `.env.local` (gitignored) / Vercel env vars.
- **Student data is sensitive** — full name, DOB, passport number, emergency contact. Treat as personal data under UK GDPR: store only what's needed, encrypt at rest where possible, never log it, never put it in URLs.
- **Everything the SLUSH owners edit must be data, not hardcoded** (see Admin, Section 8).
- **Money is handled server-side.** Never trust prices sent from the browser — recompute every total on the server from the database before charging.
- Use Plan Mode for anything touching auth, payments or the schema.

---

## 3. Design reference

Match the prototype for layout, copy and flow: split login → trip-code screen →
trip detail (two-column, tabs, sticky booking sidebar) → 30-min hold → extras →
details → payment → confirmation → dashboard (Overview) → tickets. Design language:
black/white/grey, green success pills, Inter font, horizontal numbered stepper.

---

## 4. The trip (first trip's data — but all editable in admin)

- Name: **Brumski Christmas Trip**, run by **Brumski**, operated by SLUSH
- Resort: **Alpe d'Huez, France** · Sat 12 – Sat 19 December 2026 · 7 nights
- **Base price £439 pp**, includes: 7 nights 3★ accommodation, full 6-day Alpe d'Huez lift pass, trip tee shirt
- **Capacity: 300 places** (admin-editable per trip)
- **Deposit £150** · balance due **15 Nov 2026**

**Extras** (all admin-editable; nothing pre-selected):
- Coach transport, Birmingham → Alpe d'Huez return: **£239**
- Equipment rental — one of: Skis/Boots/Poles (with quality tiers Economy/Evolution/Performance/Excellence), Snowboard & Boots, Skis/Snowboard only, Boots only, Helmet. **Prices TBC — confirm before launch.**
- Ski lessons (6 hrs, 3×2 hr): **£90**
- Events: Opening Après **£11**, Brumski Club Night **£11**, Headliner **£20**, Race day **TBC**, Railjam **TBC**

---

## 5. Data model

Design so that trips, prices, extras and capacity are all rows the admin can edit.

- **trips** — id, name, society/organiser, resort, country, start_date, end_date, nights, base_price, base_inclusions (text/JSON), deposit_amount (default 150), downpayment_amount (default 50), damage_deposit_amount (default 100), balance_due_date, capacity (default 300), description, status (draft/live/closed), created_at
- **trip_codes** — id, trip_id → trips, code (unique), active. (Supports many codes per trip later.)
- **extras** — id, trip_id → trips, type (transport/equipment/lessons/event/other), name, description, price (nullable for TBC), price_tbc (bool), has_quality_tiers (bool), sort_order, active
- **extra_tiers** — id, extra_id → extras, name (Economy/Evolution/…), price. (Only for equipment with tiers.)
- **users** — id (Supabase auth), email, first_name, last_name, title, dob, nationality, passport_number (encrypted), phone, home_address, university_society, student_id, created_at
- **emergency_contacts** — id, user_id → users, full_name, relationship, phone
- **bookings** — id, user_id → users, trip_id → trips, trip_code_id, reference (e.g. BRUM-26-0481), **status** (confirmed / waitlisted / converted / cancelled / refunded), insurance_choice (own/bought), insurance_details (JSON), access_needs, created_at
- **booking_extras** — id, booking_id → bookings, extra_id → extras, extra_tier_id (nullable), quantity, price_at_booking (snapshot)
- **payments** — id, booking_id → bookings, stripe_payment_intent_id, amount, type (deposit / balance / damage_deposit_hold / damage_deposit_refund / waitlist_refund), status, created_at
- **damage_deposits** — id, booking_id → bookings, amount (100), status (held / refunded / withheld), stripe_ref, refunded_at

Derived, never stored raw: a trip's **confirmed count** = count of bookings where status = confirmed/converted. `is_full` = confirmed_count >= capacity.

---

## 6. Booking & payment logic (precise)

Let **trip cost C** = base_price + sum of selected extras (server-computed).

- **Deposit £150 = £50 downpayment (toward the trip) + £100 refundable damage deposit.** Paying the deposit reduces the trip balance by **£50 only**. Example: C = £439 → after deposit, balance = **£389**, and £100 damage deposit is held separately.
- **Balance** = C − (total paid toward trip). Downpayment counts £50; later balance payments count in full.
- **Pay in full** = C + £100 today (whole trip + damage deposit); balance → £0.
- **Damage deposit**: held via Stripe (charge-then-refund, or manual capture), returned to the card **after the trip**, minus any withholdings. Admin triggers the refund.
- **30-minute hold**: a place is reserved for 30 min while booking. Implement server-side (a hold/expiry timestamp), not just a UI countdown — expired holds free the place.
- **Tickets** (lift pass always; coach/events if bought) unlock when balance = £0 (or 7 days before travel). Render as QR codes then.
- Deadlines: balance due 15 Nov 2026 (trip field).

---

## 7. Waiting list & capacity

- Each trip has a **capacity** (300, admin-editable). While confirmed_count < capacity, booking is normal.
- When full, the trip flips to **waiting-list mode**: the customer sees "Trip full — join the waiting list" (never a remaining-places number). Waitlisters go through the same flow and **still pay the full £150**, booking status = **waitlisted**.
- If SLUSH secures more beds, admin **converts** a waitlisted booking → status **converted** (treated as confirmed; normal balance rules apply from there).
- If not, admin **refunds the full £150** (status **refunded**) — note this returns the £50 downpayment too, unlike a normal cancellation. This is a real refund liability; surface total waitlist exposure in admin.
- **Race condition (must handle server-side):** when the last place is taken, decide confirmed vs waitlisted **at the moment of successful payment**, atomically, so you never exceed capacity. Use a DB transaction / row lock; do not rely on client state.

---

## 8. Admin / CMS (lighter v1)

Password-protected admin area for SLUSH staff (owners + Kath). Roles: admin.

Must let them, **without a developer**:
- Create/edit trips and edit key fields: name, dates, resort, base price, inclusions, description, **capacity**, deposit split, balance due date, trip code(s), status (draft/live/closed).
- Manage the extras list: add/edit/reorder, set prices, mark items **TBC**, toggle active.
- See **all bookings** for a trip with status (confirmed/waitlisted/converted/refunded), amount paid, balance outstanding.
- **Export bookings to Excel/CSV.**
- Trigger the **£100 damage-deposit refund** per booking after the trip, and the **full £150 waitlist refund** for un-converted waitlisters.
- Convert a waitlisted booking to confirmed.

Not in v1 (note for later): self-serve building of brand-new trips from a blank template, multi-role permissions, automated CRM-driven comms.

---

## 9. CRM sync (later slice — build CRM-agnostic)

The app's database is the source of truth. Build a thin sync layer that pushes key
booking/customer fields to the CRM (create/update contact + booking) via an adapter,
so the specific CRM can be plugged in once confirmed. Keep the CRM API key in env vars.
**TBC: which CRM** (HubSpot / Salesforce / other) — confirm before building this slice.

---

## 10. Build order (one slice per session)

1. Scaffold Next.js + Supabase, `.env.local`, `CLAUDE.md`, git init.
2. **Data model** + migrations (Section 5). Get this signed off before building on it.
3. Auth (student sign-up / login) + the split login screen.
4. Trip-code screen → trip detail page (read from DB).
5. Extras + details flow (server-side totals).
6. **Stripe deposit** in test mode (the £50/£100 split, 30-min hold). Hardest slice — plan carefully.
7. Confirmation + dashboard + balance payments + tickets unlock.
8. **Waiting list + capacity** incl. the race-condition handling.
9. Admin / CMS (Section 8).
10. CRM sync (Section 9).
11. Harden, test (Section 11), then deploy.

---

## 11. Test checklist (Stripe test mode)

Deposit; part-payment; pay-in-full; balance clears → tickets unlock; failed card;
damage-deposit refund; hold expiry frees the place; **two people racing for the last
place** (one confirmed, one waitlisted, never 301); waitlist join → convert; waitlist
join → full £150 refund; admin edit of price/capacity/code reflects on the live trip;
Excel export. Test on real phones.

---

## 12. To supply later (not needed to start)

- Equipment rental prices + tiers; Race day / Railjam prices.
- Which CRM (Section 9).
- Live Stripe keys + domain — **only at deploy, entered by the owner in Vercel**, never in chat or code.
- Real trip copy, images, and the SLUSH owners' legal docs (Booking Conditions, Refund Policy, privacy notice — get travel-law advice; taking money now for future travel can trigger package-travel / financial-protection obligations).
