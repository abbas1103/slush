"use server";

import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/user";
import { computePricing, type Pricing } from "@/lib/pricing/compute";
import { encryptPII } from "@/lib/crypto/pii";
import { detailsSchema, type DetailsInput } from "@/lib/validation/details";
import { stripe } from "@/lib/stripe/server";
import { CANCELABLE_PI } from "@/lib/stripe/cancelable";
import { rateLimit } from "@/lib/ratelimit";
import { TERMS_VERSION } from "@/lib/legal/version";

type AuthResult = { ok: true; user: User } | { ok: false; error: string };

/**
 * Same verified-user check as `requireVerified`, but returning a result the
 * caller can turn into a form error instead of redirecting. Reads through the
 * request-cached `getUser` (lib/auth/user.ts), so an action invoked during a
 * render that already resolved the user pays no second Auth round trip.
 */
async function getVerifiedUser(): Promise<AuthResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Please log in to continue." };
  if (!user.email_confirmed_at) return { ok: false, error: "Please confirm your email first." };
  return { ok: true, user };
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Keep the detail of a failed money/PII step server-side (Sentry, inert without
 * a DSN) so the caller can hand the student a short message instead of a raw
 * Postgres/Stripe string. Only the error's code + message is reported: a
 * PostgREST `details`/`hint` can echo row values, and these rows hold PII.
 */
function reportFailure(scope: string, cause: unknown): void {
  let detail = "unknown error";
  if (cause instanceof Error) detail = cause.message;
  else if (typeof cause === "string") detail = cause;
  else if (cause && typeof cause === "object") {
    const e = cause as { code?: unknown; message?: unknown };
    detail = `${e.code ?? "error"}: ${String(e.message ?? "unknown")}`;
  }
  Sentry.captureException(new Error(`${scope}: ${detail}`), { tags: { scope } });
}

// ── The single live PaymentIntent per booking (audit #9) ──────────────────────
// Statuses where the recorded intent can still be safely cancelled/replaced.
// Shared with the abandoned-intent sweep so the two can never drift apart.
// Statuses where money is already moving or settled - must NEVER mint a second
// chargeable intent for the booking (would double-charge; audit #9). 'succeeded'
// is handled ahead of this set: once the ledger has the payment the slot is free.
const IN_FLIGHT_PI = new Set(["processing", "succeeded", "requires_capture"]);

/** Has the ledger already recorded this intent? The webhook/reconcile writes it. */
async function ledgerHasIntent(
  admin: AdminClient,
  intentId: string,
): Promise<{ ok: true; recorded: boolean } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("payments")
    .select("id")
    .eq("stripe_payment_intent_id", intentId)
    .limit(1);
  if (error) {
    reportFailure("ledgerHasIntent", error);
    return { ok: false, error: "Couldn't check your payments - please try again in a moment." };
  }
  return { ok: true, recorded: (data ?? []).length > 0 };
}

type IntentSlot = { ok: true; reuse: string | null } | { ok: false; error: string };

/**
 * Resolve the booking's recorded intent (bookings.payment_intent_id) against the
 * amount we are about to charge. Reuses an intent for the same amount, cancels
 * one for a different amount, and refuses while money is moving - so a booking
 * can never hold two confirmable intents. `reuseAmount: null` means "never
 * reuse": the caller is about to change the cost, so the intent must die.
 * Read-only on our side; the caller records the new intent conditionally.
 */
async function resolveIntentSlot(
  admin: AdminClient,
  bookingId: string,
  recordedIntentId: string | null,
  reuseAmount: number | null,
): Promise<IntentSlot> {
  if (!recordedIntentId) return { ok: true, reuse: null };

  const NO_SUCH_INTENT = "no_such_intent" as const;
  const existing = await stripe.paymentIntents.retrieve(recordedIntentId).catch((e: unknown) => {
    // 'resource_missing' means Stripe has no such intent (e.g. an id recorded
    // against different API keys), so there is no live intent to protect.
    const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
    return code === "resource_missing" ? NO_SUCH_INTENT : null;
  });
  if (existing === null) {
    // Treating an unreadable intent as "gone" could leave a live one untracked,
    // so refuse instead - the retry costs the student a moment, not £150.
    reportFailure("resolveIntentSlot", `could not retrieve the recorded intent for booking ${bookingId}`);
    return { ok: false, error: "Couldn't reach our payment provider - please try again in a moment." };
  }
  if (existing === NO_SUCH_INTENT) return { ok: true, reuse: null };
  if (existing.status === "succeeded") {
    // Settled. The slot is only free once the ledger has this payment: a fresh
    // intent priced before it lands would ignore money already taken.
    const recorded = await ledgerHasIntent(admin, existing.id);
    if (!recorded.ok) return { ok: false, error: recorded.error };
    if (!recorded.recorded) {
      return { ok: false, error: "We're still confirming your last payment - please refresh in a moment." };
    }
    return { ok: true, reuse: null };
  }
  if (IN_FLIGHT_PI.has(existing.status)) {
    return {
      ok: false,
      error: "A payment for this booking is already being processed. Please refresh in a moment.",
    };
  }
  if (CANCELABLE_PI.has(existing.status)) {
    if (reuseAmount !== null && existing.amount === reuseAmount && existing.client_secret) {
      return { ok: true, reuse: existing.client_secret };
    }
    const cancelled = await stripe.paymentIntents
      .cancel(existing.id)
      .then(() => true)
      .catch(() => false);
    if (!cancelled) {
      return { ok: false, error: "Couldn't update your payment - please refresh and try again." };
    }
  }
  // 'canceled' (or just cancelled above): the recorded intent is dead.
  return { ok: true, reuse: null };
}

/**
 * Free the intent slot before a change that moves the booking's cost (extras,
 * the insurance cover, releasing the place). Cancels a still-cancelable intent
 * so no stale client secret can be confirmed against the old amount, and
 * refuses once money is moving (audit #1/#9/#11/#109).
 */
async function clearLiveIntent(
  admin: AdminClient,
  bookingId: string,
  recordedIntentId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!recordedIntentId) return { ok: true };

  const slot = await resolveIntentSlot(admin, bookingId, recordedIntentId, null);
  if (!slot.ok) return { ok: false, error: slot.error };

  // Conditional on the id we read: if another tab has already recorded a
  // different intent, we must not edit under it.
  const { data: cleared, error } = await admin
    .from("bookings")
    .update({ payment_intent_id: null })
    .eq("id", bookingId)
    .eq("payment_intent_id", recordedIntentId)
    .select("id")
    .maybeSingle();
  if (error) {
    reportFailure("clearLiveIntent", error);
    return { ok: false, error: "Couldn't update your booking - please refresh and try again." };
  }
  if (!cleared) {
    return { ok: false, error: "Your payment was updated in another tab - please refresh and try again." };
  }
  return { ok: true };
}

// ── Start a booking (create hold + pending booking) ──────────────────────────
export type StartResult =
  // A fresh or resumed hold: the student has 30 minutes, so expiresAt is real.
  | { ok: true; placed: false; bookingId: string; isWaitlist: boolean; expiresAt: string }
  // Already confirmed/waitlisted/converted. start_booking returns before minting
  // a hold, so there is NO expiry - the caller must route to the booking rather
  // than the checkout, and must not start a countdown.
  | { ok: true; placed: true; bookingId: string; status: string }
  | { ok: false; error: string };

export async function startBooking(code: string): Promise<StartResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Throttle the code oracle and the trips-row lock every call takes (audit
  // #21/#57). Keyed per user, not per IP: start_booking needs a confirmed
  // account, and a whole society behind one campus NAT address must not throttle
  // each other at trip launch. No-op until Upstash is configured.
  if (!(await rateLimit("tripCode", auth.user.id))) {
    return { ok: false, error: "Too many attempts - please wait a moment and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_booking", { p_code: code.trim() });
  if (error) {
    // Never return the raw Postgres exception text (audit #21).
    if (!error.message.includes("invalid or inactive trip code")) {
      reportFailure("startBooking", error);
    }
    return { ok: false, error: "That trip code isn't working - please check it and try again." };
  }
  const row = data?.[0];
  if (!row) return { ok: false, error: "Could not start your booking." };
  // An already-placed student gets their status and a null expiry. Passing that
  // null on as a date rendered a countdown from the epoch, i.e. an instantly
  // "expired" hold on a booking that is actually confirmed.
  if (row.status !== "pending" || row.expires_at === null) {
    return { ok: true, placed: true, bookingId: row.booking_id, status: row.status };
  }
  return {
    ok: true,
    placed: false,
    bookingId: row.booking_id,
    isWaitlist: row.is_waitlist,
    expiresAt: row.expires_at,
  };
}

export type ReleaseResult = { ok: true } | { ok: false; error: string };

export async function releaseHold(bookingId: string): Promise<ReleaseResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!(await rateLimit("tripCode", auth.user.id))) {
    return { ok: false, error: "Too many attempts - please wait a moment and try again." };
  }

  const admin = createAdminClient();
  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("id, user_id, status, payment_intent_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) {
    reportFailure("releaseHold.booking", bookingErr);
    return { ok: false, error: "Couldn't release your place - please refresh and try again." };
  }
  if (!booking || booking.user_id !== auth.user.id) return { ok: false, error: "Booking not found." };
  // Only a pending booking holds a place. Anything further on (a paid booking's
  // hold is already consumed) has nothing to release, and its recorded intent is
  // a balance payment this action must not touch.
  if (booking.status !== "pending") return { ok: true };

  // release_hold refuses to cancel a booking that still has a live intent (a
  // payment could land on a cancelled booking), so retire the intent first: the
  // student is walking away. Refused outright once money is moving.
  const lock = await clearLiveIntent(admin, bookingId, booking.payment_intent_id);
  if (!lock.ok) return { ok: false, error: lock.error };

  const supabase = await createClient();
  const { data: outcome, error } = await supabase.rpc("release_hold", { p_booking_id: bookingId });
  if (error) {
    reportFailure("releaseHold", error);
    return { ok: false, error: "Couldn't release your place - please refresh and try again." };
  }
  // release_hold returns a code rather than void. Reporting success on
  // 'payment_in_flight' told the student their place was released while the
  // booking stayed pending with a confirmable intent against it.
  if (outcome === "payment_in_flight") {
    return {
      ok: false,
      error: "A payment for this booking is still going through - please refresh in a moment.",
    };
  }
  return { ok: true };
}

// ── Update extras (server recomputes + snapshots prices) ─────────────────────
export interface ExtrasSelectionInput {
  extraIds: string[];
  tiers: Record<string, string>; // extraId -> tierId (for tier-priced extras)
}

// Strict boundary parse (audit #52): unknown keys rejected, ids must be uuids,
// and the list is bounded. Duplicates are removed below so a repeated id can
// never become a duplicate charged line item.
const extrasSelectionSchema = z
  .object({
    extraIds: z.array(z.uuid()).max(50),
    tiers: z.record(z.uuid(), z.uuid()),
  })
  .strict();

export type UpdateExtrasResult =
  | { ok: true; pricing: Pricing }
  | { ok: false; error: string };

export async function updateExtras(
  bookingId: string,
  selection: ExtrasSelectionInput,
): Promise<UpdateExtrasResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsedSelection = extrasSelectionSchema.safeParse(selection);
  if (!parsedSelection.success) {
    return { ok: false, error: "Please reselect your extras and try again." };
  }
  const extraIds = [...new Set(parsedSelection.data.extraIds)];
  const tiers = parsedSelection.data.tiers;

  const admin = createAdminClient();

  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("id, user_id, trip_id, status, payment_intent_id, base_price_at_booking")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) {
    reportFailure("updateExtras.booking", bookingErr);
    return { ok: false, error: "Couldn't load your booking - please refresh and try again." };
  }
  if (!booking || booking.user_id !== auth.user.id) {
    return { ok: false, error: "Booking not found." };
  }
  if (booking.status !== "pending") {
    return { ok: false, error: "This booking can no longer be edited." };
  }

  const { data: trip, error: tripErr } = await admin
    .from("trips")
    .select("base_price, deposit_amount, downpayment_amount, damage_deposit_amount")
    .eq("id", booking.trip_id)
    .maybeSingle();
  if (tripErr || !trip) {
    if (tripErr) reportFailure("updateExtras.trip", tripErr);
    return { ok: false, error: "Couldn't load your trip - please refresh and try again." };
  }
  const { data: catalogue, error: catalogueErr } = await admin
    .from("extras")
    .select("id, name, type, price, price_tbc, has_quality_tiers, single_select_group, active, extra_tiers(id, name, price)")
    .eq("trip_id", booking.trip_id);
  if (catalogueErr || !catalogue) {
    if (catalogueErr) reportFailure("updateExtras.catalogue", catalogueErr);
    return { ok: false, error: "Couldn't load the extras for this trip - please refresh and try again." };
  }

  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const rows: {
    booking_id: string;
    extra_id: string;
    extra_tier_id: string | null;
    quantity: number;
    price_at_booking: number;
  }[] = [];
  const seenGroups = new Set<string>();

  for (const id of extraIds) {
    const ex = byId.get(id);
    if (!ex || !ex.active) return { ok: false, error: "Invalid extra selected." };
    // 'other' is the winter-sports cover, chosen on the details step. Say so
    // rather than dropping it silently (audit #101).
    if (ex.type === "other") {
      return { ok: false, error: "Winter sports cover is chosen on the next step, with your details." };
    }
    if (ex.single_select_group) {
      if (seenGroups.has(ex.single_select_group)) {
        return { ok: false, error: "Only one option can be selected per group." };
      }
      seenGroups.add(ex.single_select_group);
    }

    let price: number;
    let tierId: string | null = null;
    if (ex.has_quality_tiers) {
      tierId = tiers[id] ?? null;
      const tier = ex.extra_tiers?.find((t) => t.id === tierId);
      if (!tier) return { ok: false, error: `Choose a quality level for ${ex.name}.` };
      price = tier.price;
    } else {
      if (ex.price_tbc || ex.price == null) {
        return { ok: false, error: `${ex.name} is not bookable yet.` };
      }
      price = ex.price;
    }
    rows.push({ booking_id: bookingId, extra_id: id, extra_tier_id: tierId, quantity: 1, price_at_booking: price });
  }

  // Extras lock: a payable intent commits the amount, so editing extras under it
  // would let the charge and the recorded cost diverge (audit #1/#9). Retire the
  // intent instead of sending the student off to "start over", which never
  // cleared the lock (audit #48); the payment step mints a fresh, correct one.
  const lock = await clearLiveIntent(admin, bookingId, booking.payment_intent_id);
  if (!lock.ok) return { ok: false, error: lock.error };

  // Replace only the non-insurance extras (leave any 'other' cover row intact).
  // A failed delete would leave stale rows that are summed into the charge, so
  // it must abort rather than be ignored (audit #108).
  const nonOtherIds = catalogue.filter((e) => e.type !== "other").map((e) => e.id);
  if (nonOtherIds.length) {
    const { error } = await admin
      .from("booking_extras")
      .delete()
      .eq("booking_id", bookingId)
      .in("extra_id", nonOtherIds);
    if (error) {
      reportFailure("updateExtras.delete", error);
      return { ok: false, error: "Couldn't update your extras - please try again." };
    }
  }
  if (rows.length) {
    const { error } = await admin.from("booking_extras").insert(rows);
    if (error) {
      reportFailure("updateExtras.insert", error);
      return { ok: false, error: "Couldn't update your extras - please try again." };
    }
  }

  // Recompute the total from ALL current booking extras (so a preserved
  // insurance-cover row is still counted), with labels for the sidebar.
  const { data: current, error: currentErr } = await admin
    .from("booking_extras")
    .select("price_at_booking, quantity, extras(name), extra_tiers(name)")
    .eq("booking_id", bookingId);
  if (currentErr || !current) {
    if (currentErr) reportFailure("updateExtras.current", currentErr);
    return { ok: false, error: "Your extras were saved, but we couldn't refresh the total - please reload." };
  }
  const finalLineItems = current.map((row) => {
    const extra = row.extras as { name: string } | null;
    const tier = row.extra_tiers as { name: string } | null;
    return {
      label: `${extra?.name ?? "Extra"}${tier ? ` - ${tier.name}` : ""}`,
      amount: row.price_at_booking * row.quantity,
    };
  });

  const pricing = computePricing({
    // The price the place was sold at wins over the trip's current price (audit
    // #10), mirroring compute_trip_cost's coalesce.
    basePrice: booking.base_price_at_booking ?? trip.base_price,
    depositAmount: trip.deposit_amount,
    downpaymentAmount: trip.downpayment_amount,
    damageDepositAmount: trip.damage_deposit_amount,
    extras: finalLineItems,
  });
  return { ok: true, pricing };
}

// ── Save booking details (PII encrypted; insurance + consents persisted) ─────
export type SaveDetailsResult = { ok: true } | { ok: false; error: string };

export async function saveDetails(
  bookingId: string,
  input: DetailsInput,
): Promise<SaveDetailsResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your details." };
  }
  const d = parsed.data;

  const admin = createAdminClient();
  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("id, user_id, trip_id, status, payment_intent_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) {
    reportFailure("saveDetails.booking", bookingErr);
    return { ok: false, error: "Couldn't load your booking - please refresh and try again." };
  }
  if (!booking || booking.user_id !== auth.user.id) return { ok: false, error: "Booking not found." };
  if (booking.status !== "pending") return { ok: false, error: "This booking can no longer be edited." };

  const { data: trip, error: tripErr } = await admin
    .from("trips")
    .select("start_date")
    .eq("id", booking.trip_id)
    .maybeSingle();
  if (tripErr || !trip) {
    if (tripErr) reportFailure("saveDetails.trip", tripErr);
    return { ok: false, error: "Couldn't load your trip - please refresh and try again." };
  }

  // 18+ on arrival
  const start = new Date(`${trip.start_date}T00:00:00`);
  const dob = new Date(`${d.dob}T00:00:00`);
  let age = start.getFullYear() - dob.getFullYear();
  const monthDiff = start.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && start.getDate() < dob.getDate())) age--;
  // Reject unparseable DOB too: NaN < 18 is false, which would silently skip
  // the gate (audit #4). details.ts also validates the calendar date.
  if (!Number.isFinite(age) || age < 18) {
    return { ok: false, error: "You must be 18 or over on arrival in resort." };
  }

  // ── Insurance cover extra (type 'other'), resolved before any write ────────
  // 'other' means the winter-sports cover here, so exactly one active row is a
  // valid trip setup. Picking an arbitrary row could sell a hoodie as insurance
  // at the wrong price (audit #101), so an ambiguous catalogue fails loudly.
  const { data: otherExtras, error: otherErr } = await admin
    .from("extras")
    .select("id, price, active")
    .eq("trip_id", booking.trip_id)
    .eq("type", "other")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (otherErr || !otherExtras) {
    if (otherErr) reportFailure("saveDetails.coverCatalogue", otherErr);
    return { ok: false, error: "Couldn't load the extras for this trip - please refresh and try again." };
  }
  const coverIds = otherExtras.map((e) => e.id);
  const activeCovers = otherExtras.filter((e) => e.active);
  const cover = activeCovers.length === 1 ? activeCovers[0] : null;
  const wantsCover = d.insuranceChoice === "bought";
  if (wantsCover && (!cover || cover.price == null)) {
    reportFailure(
      "saveDetails.cover",
      `trip ${booking.trip_id} has ${activeCovers.length} active 'other' extras, none usable as the cover`,
    );
    return {
      ok: false,
      error: "Winter sports cover can't be added right now - please use your own policy or get in touch.",
    };
  }

  let coverRows: { id: string; extra_id: string }[] = [];
  if (coverIds.length) {
    const { data, error } = await admin
      .from("booking_extras")
      .select("id, extra_id")
      .eq("booking_id", bookingId)
      .in("extra_id", coverIds);
    if (error) {
      reportFailure("saveDetails.coverRows", error);
      return { ok: false, error: "Couldn't load your extras - please refresh and try again." };
    }
    coverRows = data ?? [];
  }
  const hasExactCover = !!cover && coverRows.length === 1 && coverRows[0].extra_id === cover.id;
  const coverChanges = wantsCover ? !hasExactCover : coverRows.length > 0;
  if (coverChanges) {
    // Adding or removing the cover moves the trip cost, so this needs the same
    // single-live-intent lock updateExtras applies (audit #11/#109) - otherwise
    // a tab holding a minted client secret could pay a total we just changed.
    const lock = await clearLiveIntent(admin, bookingId, booking.payment_intent_id);
    if (!lock.ok) return { ok: false, error: lock.error };
  }

  const nowIso = new Date().toISOString();

  // Profile (sensitive fields encrypted at rest)
  const { error: userErr } = await admin
    .from("users")
    .update({
      title: d.title,
      first_name: d.firstName,
      last_name: d.lastName,
      university_society: d.universitySociety || null,
      student_id: d.studentId || null,
      dob: encryptPII(d.dob),
      nationality: d.nationality,
      passport_number: encryptPII(d.passportNumber),
      phone: encryptPII(d.phone),
    })
    .eq("id", auth.user.id);
  if (userErr) {
    reportFailure("saveDetails.profile", userErr);
    return { ok: false, error: "Couldn't save your details - please try again." };
  }

  // Emergency contact (single primary): replace. Both statements are checked -
  // a silent failure here leaves a student with no emergency contact and the UI
  // reporting success (audit #42).
  const { error: contactDelErr } = await admin
    .from("emergency_contacts")
    .delete()
    .eq("user_id", auth.user.id);
  if (contactDelErr) {
    reportFailure("saveDetails.contactDelete", contactDelErr);
    return { ok: false, error: "Couldn't save your emergency contact - please try again." };
  }
  const { error: contactInsErr } = await admin.from("emergency_contacts").insert({
    user_id: auth.user.id,
    // Non-null: detailsSchema requires non-empty name/phone, so the cipher is
    // always a string (encryptPII only returns null for empty/null input).
    full_name: encryptPII(d.emergencyName)!,
    relationship: d.emergencyRelationship || null,
    phone: encryptPII(d.emergencyPhone)!,
  });
  if (contactInsErr) {
    reportFailure("saveDetails.contactInsert", contactInsErr);
    return { ok: false, error: "Couldn't save your emergency contact - please try again." };
  }

  // Booking: insurance choice + encrypted policy/access-needs
  const insuranceDetails =
    d.insuranceChoice === "own"
      ? { insurer: d.insurer, policy: encryptPII(d.policyNumber), emergency_line: d.insuranceEmergencyLine }
      : null;
  const { error: bookingUpdErr } = await admin
    .from("bookings")
    .update({
      insurance_choice: d.insuranceChoice,
      insurance_details: insuranceDetails,
      access_needs: encryptPII(d.accessNeeds || null),
    })
    .eq("id", bookingId);
  if (bookingUpdErr) {
    reportFailure("saveDetails.booking", bookingUpdErr);
    return { ok: false, error: "Couldn't save your details - please try again." };
  }

  // Insurance cover extra: add if bought, remove if own. Money, so both
  // statements are checked (audit #108).
  if (coverChanges) {
    if (coverRows.length) {
      const { error } = await admin
        .from("booking_extras")
        .delete()
        .eq("booking_id", bookingId)
        .in("extra_id", coverIds);
      if (error) {
        reportFailure("saveDetails.coverDelete", error);
        return { ok: false, error: "Couldn't save your insurance choice - please try again." };
      }
    }
    if (wantsCover && cover && cover.price != null) {
      const { error } = await admin.from("booking_extras").insert({
        booking_id: bookingId,
        extra_id: cover.id,
        quantity: 1,
        price_at_booking: cover.price,
      });
      if (error) {
        reportFailure("saveDetails.coverInsert", error);
        return { ok: false, error: "Couldn't save your insurance choice - please try again." };
      }
    }
  }

  // Consents (one record per booking): replace, no pre-ticked boxes. Checked -
  // the terms version + timestamps are the record of acceptance (audit #42).
  const { error: consentDelErr } = await admin.from("consents").delete().eq("booking_id", bookingId);
  if (consentDelErr) {
    reportFailure("saveDetails.consentDelete", consentDelErr);
    return { ok: false, error: "Couldn't record your declarations - please try again." };
  }
  const { error: consentInsErr } = await admin.from("consents").insert({
    user_id: auth.user.id,
    booking_id: bookingId,
    // The identifier the /terms page actually displays, not a hardcoded literal:
    // a consent row must name wording that exists.
    terms_version: TERMS_VERSION,
    terms_accepted_at: nowIso,
    marketing_opt_in: d.marketingOptIn,
    marketing_opt_in_at: d.marketingOptIn ? nowIso : null,
    health_data_consent: !!d.accessNeeds,
    health_data_consent_at: d.accessNeeds ? nowIso : null,
    share_access_needs_with_resort: d.shareAccessNeeds,
    share_access_needs_at: d.shareAccessNeeds ? nowIso : null,
  });
  if (consentInsErr) {
    reportFailure("saveDetails.consentInsert", consentInsErr);
    return { ok: false, error: "Couldn't record your declarations - please try again." };
  }

  return { ok: true };
}

// ── Create a PaymentIntent (amount recomputed server-side; never trusted) ────
export type IntentResult =
  | { ok: true; clientSecret: string; amount: number }
  | { ok: false; error: string };

type PricingResult = { ok: true; pricing: Pricing } | { ok: false; error: string };

async function bookingPricing(
  admin: AdminClient,
  bookingId: string,
  tripId: string,
  basePriceAtBooking: number | null,
): Promise<PricingResult> {
  const { data: trip, error: tripErr } = await admin
    .from("trips")
    .select("base_price, deposit_amount, downpayment_amount, damage_deposit_amount")
    .eq("id", tripId)
    .maybeSingle();
  if (tripErr || !trip) {
    if (tripErr) reportFailure("bookingPricing.trip", tripErr);
    return { ok: false, error: "Couldn't load your trip - please refresh and try again." };
  }
  const { data: bes, error: besErr } = await admin
    .from("booking_extras")
    .select("price_at_booking, quantity")
    .eq("booking_id", bookingId);
  if (besErr || !bes) {
    if (besErr) reportFailure("bookingPricing.extras", besErr);
    return { ok: false, error: "Couldn't load your extras - please refresh and try again." };
  }
  return {
    ok: true,
    pricing: computePricing({
      // The snapshotted price the place was sold at wins over the trip's current
      // base price, so an admin edit can't reprice a taken booking (audit #10).
      basePrice: basePriceAtBooking ?? trip.base_price,
      depositAmount: trip.deposit_amount,
      downpaymentAmount: trip.downpayment_amount,
      damageDepositAmount: trip.damage_deposit_amount,
      extras: bes.map((b) => ({ label: "", amount: b.price_at_booking * b.quantity })),
    }),
  };
}

const PaymentMode = z.enum(["deposit", "full"]);

/**
 * Create the intent and record it as the booking's single live intent. The
 * update is conditional on the id we read, so if a concurrent call won the slot
 * we cancel our intent rather than leave a second confirmable one behind
 * (audit #9/#13/#51). The idempotency key includes that id, so a retry after a
 * lost response returns the same intent instead of minting a second, while a
 * later, genuinely different attempt gets its own key.
 */
async function createTrackedIntent(
  admin: AdminClient,
  opts: {
    bookingId: string;
    tripId: string;
    reference: string;
    kind: "deposit" | "full" | "balance";
    amount: number;
    recordedIntentId: string | null;
  },
): Promise<IntentResult> {
  const intent = await stripe.paymentIntents
    .create(
      {
        amount: opts.amount,
        currency: "gbp",
        automatic_payment_methods: { enabled: true },
        metadata: {
          booking_id: opts.bookingId,
          trip_id: opts.tripId,
          payment_kind: opts.kind,
          reference: opts.reference,
        },
      },
      {
        // Per-attempt key, deliberately NOT derived from (booking, kind, amount).
        // A composed key collides across generations: clearLiveIntent cancels the
        // live intent and nulls payment_intent_id, so the next deposit mint has
        // the same booking, kind, amount (the deposit is a flat trip field) and
        // the same null slot - Stripe then REPLAYS the cached create and hands
        // back the intent it just cancelled, whose client secret cannot be
        // confirmed. Uniqueness per attempt cannot double-charge: the single-live
        // -intent guarantee comes from resolveIntentSlot plus the conditional
        // payment_intent_id update below, which cancels whichever intent loses.
        idempotencyKey: `pi:${opts.bookingId}:${opts.kind}:${crypto.randomUUID()}`,
      },
    )
    .catch((e: unknown) => {
      // Never surface the raw Stripe message to the student.
      reportFailure("createTrackedIntent.create", e);
      return null;
    });
  if (!intent) return { ok: false, error: "Couldn't start your payment - please refresh and try again." };
  if (!intent.client_secret) return { ok: false, error: "Could not initialise payment." };

  const track = admin.from("bookings").update({ payment_intent_id: intent.id }).eq("id", opts.bookingId);
  const { data: tracked, error: trackErr } = await (
    opts.recordedIntentId
      ? track.eq("payment_intent_id", opts.recordedIntentId)
      : track.is("payment_intent_id", null)
  )
    .select("id")
    .maybeSingle();
  if (trackErr || !tracked) {
    if (trackErr) reportFailure("createTrackedIntent.track", trackErr);
    // Did a concurrent call already record THIS intent (the idempotent create
    // returns the same one)? Then it is the single live intent after all. A
    // failed read here falls through to the cancel below - the safe direction.
    const { data: fresh } = await admin
      .from("bookings")
      .select("payment_intent_id")
      .eq("id", opts.bookingId)
      .maybeSingle();
    if (fresh?.payment_intent_id === intent.id) {
      return { ok: true, clientSecret: intent.client_secret, amount: intent.amount };
    }
    // An untracked live intent is invisible to the double-charge guard, and its
    // client secret must never reach the browser (audit #13). Kill it.
    await stripe.paymentIntents.cancel(intent.id).catch(() => null);
    return { ok: false, error: "Couldn't start your payment - please refresh and try again." };
  }
  return { ok: true, clientSecret: intent.client_secret, amount: intent.amount };
}

export async function createPaymentIntent(
  bookingId: string,
  mode: "deposit" | "full",
): Promise<IntentResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!(await rateLimit("payment", auth.user.id))) return { ok: false, error: "Too many attempts - please wait a moment." };

  // The mode string becomes the ledger's payment_kind - never trust it raw.
  const parsedMode = PaymentMode.safeParse(mode);
  if (!parsedMode.success) return { ok: false, error: "Invalid payment option." };
  const payMode = parsedMode.data;

  const admin = createAdminClient();
  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("id, user_id, trip_id, status, reference, payment_intent_id, base_price_at_booking, insurance_choice")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) {
    reportFailure("createPaymentIntent.booking", bookingErr);
    return { ok: false, error: "Couldn't load your booking - please refresh and try again." };
  }
  if (!booking || booking.user_id !== auth.user.id) return { ok: false, error: "Booking not found." };
  if (booking.status !== "pending") return { ok: false, error: "This booking is no longer payable." };

  // Never mint a chargeable intent before the details step has run (audit #39).
  // The payment page redirects on the same condition, but that only closes the
  // navigational half: this is a server action, so it is directly callable and
  // must enforce the gate itself. saveDetails is the sole writer of the consents
  // record, the passport/DOB PII, the insurance declaration and the 18+ check.
  const { data: consent, error: consentErr } = await admin
    .from("consents")
    .select("id")
    .eq("booking_id", bookingId)
    .limit(1)
    .maybeSingle();
  if (consentErr) {
    reportFailure("createPaymentIntent.consent", consentErr);
    return { ok: false, error: "Couldn't load your booking - please refresh and try again." };
  }
  if (!consent || booking.insurance_choice === null) {
    return { ok: false, error: "Please complete your details before paying." };
  }

  // Amount is computed from the DB - the browser never sends it.
  const priced = await bookingPricing(admin, bookingId, booking.trip_id, booking.base_price_at_booking);
  if (!priced.ok) return { ok: false, error: priced.error };
  const amount = payMode === "deposit" ? priced.pricing.depositToday : priced.pricing.payInFullToday;

  // One live deposit/full intent per booking (audit #9): reuse the existing
  // intent on a reload (same amount, still completable), and on a mode switch
  // cancel it first so two intents can't both be confirmed.
  const slot = await resolveIntentSlot(admin, bookingId, booking.payment_intent_id, amount);
  if (!slot.ok) return { ok: false, error: slot.error };
  if (slot.reuse) return { ok: true, clientSecret: slot.reuse, amount };

  return await createTrackedIntent(admin, {
    bookingId,
    tripId: booking.trip_id,
    reference: booking.reference,
    kind: payMode,
    amount,
    recordedIntentId: booking.payment_intent_id,
  });
}

// ── Balance payment intent (amount clamped server-side to [£1, outstanding]) ──
export async function createBalancePaymentIntent(
  bookingId: string,
  requestedAmount: number,
): Promise<IntentResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!(await rateLimit("payment", auth.user.id))) return { ok: false, error: "Too many attempts - please wait a moment." };

  const admin = createAdminClient();
  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("id, user_id, trip_id, status, reference, payment_intent_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) {
    reportFailure("createBalancePaymentIntent.booking", bookingErr);
    return { ok: false, error: "Couldn't load your booking - please refresh and try again." };
  }
  if (!booking || booking.user_id !== auth.user.id) return { ok: false, error: "Booking not found." };
  if (booking.status !== "confirmed" && booking.status !== "converted") {
    return { ok: false, error: "Balance payments open once your place is confirmed." };
  }

  // Outstanding balance from the DB function (trip cost − trip money received,
  // including any waitlist refund). A failed read is an error, never a silent
  // "you have paid nothing" that would re-charge the whole trip (audit #40).
  const { data: balance, error: balanceErr } = await admin.rpc("booking_balance", {
    p_booking_id: bookingId,
  });
  if (balanceErr || balance == null) {
    if (balanceErr) reportFailure("createBalancePaymentIntent.balance", balanceErr);
    return { ok: false, error: "Couldn't work out your balance - please refresh and try again." };
  }
  if (balance <= 0) return { ok: false, error: "Your balance is already cleared." };

  // Clamp to what's owed - NEVER charge more than the outstanding balance
  // (audit #6: the old £1 floor applied last could overcharge a sub-£1 balance).
  const parsedReq = z.number().int().positive().safeParse(Math.round(requestedAmount));
  if (!parsedReq.success) return { ok: false, error: "Enter a valid amount." };
  const amount = Math.min(parsedReq.data, balance);
  const STRIPE_MIN_GBP = 30; // Stripe's minimum GBP charge is £0.30
  if (amount < STRIPE_MIN_GBP) {
    return balance < STRIPE_MIN_GBP
      ? { ok: false, error: "Your remaining balance is under £0.30 - please contact us to settle it." }
      : { ok: false, error: "The minimum card payment is £0.30." };
  }

  // One live balance intent too (audit #51): two intents each clamped against
  // the same not-yet-settled balance could otherwise both be paid, overpaying
  // it with no self-service refund. Changing the amount cancels the old one.
  const slot = await resolveIntentSlot(admin, bookingId, booking.payment_intent_id, amount);
  if (!slot.ok) return { ok: false, error: slot.error };
  if (slot.reuse) return { ok: true, clientSecret: slot.reuse, amount };

  return await createTrackedIntent(admin, {
    bookingId,
    tripId: booking.trip_id,
    reference: booking.reference,
    kind: "balance",
    amount,
    recordedIntentId: booking.payment_intent_id,
  });
}

// ── Reconcile a payment on return (resilient to webhook lag/miss) ────────────
// The webhook is the canonical async writer; this is the belt-and-braces path
// for when the user returns from Stripe before the event lands. Retrieves the
// PaymentIntent server-side, verifies it belongs to the caller's booking, and
// finalizes idempotently (same RPC + dedupe as the webhook).
export async function reconcilePayment(
  bookingId: string,
  paymentIntentId: string,
): Promise<{ ok: boolean; status?: string }> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false };
  if (!(await rateLimit("payment", auth.user.id))) return { ok: false };
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return { ok: false };

  const admin = createAdminClient();
  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("id, user_id, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) {
    reportFailure("reconcilePayment.booking", bookingErr);
    return { ok: false };
  }
  if (!booking || booking.user_id !== auth.user.id) return { ok: false };
  // 'refunded' is terminal: the money has gone back, so finalising against it
  // could only re-arm financial rows (audit #1). Nothing left to reconcile.
  if (booking.status === "refunded") return { ok: false };

  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return { ok: false };
  }
  // The PI must belong to THIS booking (prevents finalising an unrelated intent).
  if (pi.metadata?.booking_id !== bookingId) return { ok: false };

  if (pi.status === "succeeded") {
    const kind = pi.metadata.payment_kind;
    const charge = typeof pi.latest_charge === "string" ? pi.latest_charge : "";
    if (kind) {
      // Replay guard (audit #1): the ledger is written once per intent, so if a
      // payments row already exists this call is a replay. Re-running finalize
      // then has nothing to add and could re-arm a refunded damage deposit.
      const recorded = await ledgerHasIntent(admin, pi.id);
      if (!recorded.ok) return { ok: false };
      if (!recorded.recorded) {
        const { error } = await admin.rpc("record_payment_and_finalize", {
          p_booking_id: bookingId,
          p_intent_id: pi.id,
          p_charge_id: charge,
          p_kind: kind,
          p_amount_total: pi.amount,
        });
        if (error) {
          // Report ok:false so the caller keeps ?payment_intent= and can retry;
          // the webhook remains the canonical writer (audit #43/#54).
          reportFailure(`reconcilePayment.finalize:${bookingId}`, error);
          return { ok: false, status: pi.status };
        }
      }
    }
  }
  return { ok: true, status: pi.status };
}
