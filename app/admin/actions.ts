"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { requireAdminMfa } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { formatPence } from "@/lib/utils/money";
import type { Json } from "@/lib/db/types";

type Result = { ok: true } | { ok: false; error: string };

// Strict Zod schemas for admin writes (audit #11). `.strict()` rejects unknown
// keys → no mass-assignment (e.g. an injected trip_id on saveExtra); money and
// capacity fields are bounded non-negative integers so no negative/fractional
// pence can be persisted. DB rows are built from PARSED data, never raw input.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const pence = z.number().int().nonnegative();

const tripInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    organiser: z.string().min(1).max(200),
    resort: z.string().min(1).max(200),
    country: z.string().min(1).max(100),
    start_date: isoDate,
    end_date: isoDate,
    nights: z.number().int().positive().max(60),
    base_price: pence,
    base_inclusions: z.array(z.string().max(300)).max(100),
    deposit_amount: pence,
    downpayment_amount: pence,
    damage_deposit_amount: pence,
    balance_due_date: isoDate.nullable(),
    capacity: z.number().int().nonnegative().max(100000),
    description: z.string().max(5000),
    status: z.enum(["draft", "live", "closed"]),
  })
  .strict();

const extraInputSchema = z
  .object({
    type: z.enum(["transport", "equipment", "lessons", "event", "other"]),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    price: pence.nullable(),
    price_tbc: z.boolean(),
    has_quality_tiers: z.boolean(),
    single_select_group: z.string().max(100).nullable(),
    sort_order: z.number().int().nonnegative(),
    active: z.boolean(),
  })
  .strict();

/**
 * Append the audit_log row for a mutation (audit #105, #123).
 *
 * Takes the ALREADY-authorised user: it must never call requireAdminMfa() again,
 * because that redirect()s, and a redirect thrown after the write has committed
 * loses the trail and returns a redirect instead of a result.
 *
 * The insert error is RETURNED, not swallowed. audit_log is the only record of
 * who moved money, so callers treat a missing trail as a failed action. Every
 * caller audits AFTER its write, so the message says the change did land.
 */
async function audit(
  user: User,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Json,
): Promise<Result> {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_log").insert({
    actor_user_id: user.id,
    actor_email: user.email ?? null,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata, // NO PII - refs/amounts/status only
  });
  if (error) {
    return { ok: false, error: `The change went through but the audit trail could not be written: ${error.message}` };
  }
  return { ok: true };
}

/**
 * True only when Stripe received the call and refused it, so no refund exists
 * and releasing our claim on the row is safe. A connection or timeout error is
 * ambiguous (the refund may well have gone through), so those fail closed: the
 * claim stands and the admin is told to check Stripe.
 */
function stripeRefusedRequest(e: unknown): boolean {
  // Every Stripe error extends Error and carries its class name in `type`.
  if (!(e instanceof Error) || !("type" in e)) return false;
  return e.type === "StripeInvalidRequestError" || e.type === "StripeCardError";
}

// ── Trips ────────────────────────────────────────────────────────────────
export interface TripInput {
  name: string;
  organiser: string;
  resort: string;
  country: string;
  start_date: string;
  end_date: string;
  nights: number;
  base_price: number;
  base_inclusions: string[];
  deposit_amount: number;
  downpayment_amount: number;
  damage_deposit_amount: number;
  balance_due_date: string | null;
  capacity: number;
  description: string;
  status: "draft" | "live" | "closed";
}

export async function saveTrip(tripId: string | null, input: TripInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireAdminMfa();
  const parsed = tripInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid trip data." };
  const admin = createAdminClient();
  const row = parsed.data;
  if (tripId) {
    // #111: capacity is the cap finalize_booking() compares confirmed_count
    // against, so it must never drop below the seats already sold - that would
    // leave the trip over capacity and quietly waitlist every later payment.
    const { data: current, error: currentError } = await admin
      .from("trips")
      .select("confirmed_count")
      .eq("id", tripId)
      .maybeSingle();
    if (currentError) return { ok: false, error: currentError.message };
    if (!current) return { ok: false, error: "Could not find that trip." };
    if (row.capacity < current.confirmed_count) {
      return {
        ok: false,
        error: `Capacity cannot be below the ${current.confirmed_count} bookings already confirmed.`,
      };
    }
    const { error } = await admin.from("trips").update(row).eq("id", tripId);
    if (error) return { ok: false, error: error.message };
    const logged = await audit(user, "trip_update", "trip", tripId, { status: row.status, capacity: row.capacity, base_price: row.base_price });
    if (!logged.ok) return logged;
    revalidatePath("/admin");
    revalidatePath(`/admin/trips/${tripId}`);
    return { ok: true, id: tripId };
  }
  const { data, error } = await admin.from("trips").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create trip." };
  const loggedCreate = await audit(user, "trip_create", "trip", data.id, { status: row.status });
  if (!loggedCreate.ok) return loggedCreate;
  revalidatePath("/admin");
  return { ok: true, id: data.id };
}

// ── Trip codes ─────────────────────────────────────────────────────────────
export async function addTripCode(tripId: string, code: string): Promise<Result> {
  const user = await requireAdminMfa();
  const parsed = z.string().trim().min(3).max(64).safeParse(code);
  if (!parsed.success) return { ok: false, error: "Code must be 3-64 characters." };
  const admin = createAdminClient();
  const { error } = await admin.from("trip_codes").insert({ trip_id: tripId, code: parsed.data, active: true });
  if (error) return { ok: false, error: error.message };
  const logged = await audit(user, "trip_code_add", "trip", tripId, { code: parsed.data });
  if (!logged.ok) return logged;
  revalidatePath(`/admin/trips/${tripId}`);
  return { ok: true };
}

export async function setTripCodeActive(codeId: string, tripId: string, active: boolean): Promise<Result> {
  const user = await requireAdminMfa();
  const admin = createAdminClient();
  const { error } = await admin.from("trip_codes").update({ active }).eq("id", codeId);
  if (error) return { ok: false, error: error.message };
  const logged = await audit(user, "trip_code_toggle", "trip_code", codeId, { active });
  if (!logged.ok) return logged;
  revalidatePath(`/admin/trips/${tripId}`);
  return { ok: true };
}

// ── Extras ─────────────────────────────────────────────────────────────────
export interface ExtraInput {
  type: "transport" | "equipment" | "lessons" | "event" | "other";
  name: string;
  description: string | null;
  price: number | null;
  price_tbc: boolean;
  has_quality_tiers: boolean;
  single_select_group: string | null;
  sort_order: number;
  active: boolean;
}

export async function saveExtra(extraId: string | null, tripId: string, input: ExtraInput): Promise<Result> {
  const user = await requireAdminMfa();
  const parsed = extraInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid extra data." };
  const data = parsed.data;
  const admin = createAdminClient();
  if (extraId) {
    // Scoped to the trip, and the returned row proves the update actually landed.
    const { data: updated, error } = await admin
      .from("extras")
      .update(data)
      .eq("id", extraId)
      .eq("trip_id", tripId)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!updated?.length) return { ok: false, error: "Could not find that extra on this trip." };
  } else {
    const { error } = await admin.from("extras").insert({ ...data, trip_id: tripId });
    if (error) return { ok: false, error: error.message };
  }
  const logged = await audit(user, "extra_save", "trip", tripId, { name: data.name, price: data.price, active: data.active });
  if (!logged.ok) return logged;
  revalidatePath(`/admin/trips/${tripId}/extras`);
  // #140: the extras catalogue is rendered by the dynamic /trip/[code] page, not
  // by /trip (which is just the code-entry form). This is the form that matches
  // every rendered instance of a dynamic segment.
  revalidatePath("/trip/[code]", "page");
  return { ok: true };
}

export async function reorderExtras(tripId: string, orderedIds: string[]): Promise<Result> {
  const user = await requireAdminMfa();
  const parsed = z.array(z.uuid()).max(500).safeParse(orderedIds);
  if (!parsed.success) return { ok: false, error: "Invalid extra order." };
  const admin = createAdminClient();
  // Every id must belong to this trip, so a stray one can't reorder another
  // trip's extras or silently no-op halfway through the loop.
  const { data: owned, error: ownedError } = await admin
    .from("extras")
    .select("id")
    .eq("trip_id", tripId)
    .in("id", parsed.data);
  if (ownedError) return { ok: false, error: ownedError.message };
  if ((owned?.length ?? 0) !== parsed.data.length) {
    return { ok: false, error: "Those extras don't all belong to this trip." };
  }
  for (let i = 0; i < parsed.data.length; i++) {
    const { error } = await admin
      .from("extras")
      .update({ sort_order: i + 1 })
      .eq("id", parsed.data[i])
      .eq("trip_id", tripId);
    if (error) return { ok: false, error: error.message };
  }
  const logged = await audit(user, "extras_reorder", "trip", tripId, { order: parsed.data });
  if (!logged.ok) return logged;
  revalidatePath(`/admin/trips/${tripId}/extras`);
  revalidatePath("/trip/[code]", "page");
  return { ok: true };
}

export async function saveTier(tierId: string | null, extraId: string, tripId: string, name: string, price: number, sortOrder: number): Promise<Result> {
  const user = await requireAdminMfa();
  const parsed = z
    .object({ name: z.string().min(1).max(120), price: pence, sortOrder: z.number().int().nonnegative() })
    .safeParse({ name, price, sortOrder });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid tier data." };
  const admin = createAdminClient();
  // #69: a tier price IS the money the student is charged, so the trail has to
  // record the price it replaced, not just the new one.
  let previousPrice: number | null = null;
  if (tierId) {
    const { data: existing, error: existingError } = await admin
      .from("extra_tiers")
      .select("price")
      .eq("id", tierId)
      .maybeSingle();
    if (existingError) return { ok: false, error: existingError.message };
    previousPrice = existing?.price ?? null;
  }
  const row = { extra_id: extraId, name: parsed.data.name, price: parsed.data.price, sort_order: parsed.data.sortOrder };
  const { error } = tierId
    ? await admin.from("extra_tiers").update(row).eq("id", tierId)
    : await admin.from("extra_tiers").insert(row);
  if (error) return { ok: false, error: error.message };
  const logged = await audit(user, tierId ? "extra_tier_update" : "extra_tier_create", "extra", extraId, {
    tier_id: tierId,
    name: parsed.data.name,
    price: parsed.data.price,
    previous_price: previousPrice,
  });
  if (!logged.ok) return logged;
  revalidatePath(`/admin/trips/${tripId}/extras`);
  revalidatePath("/trip/[code]", "page");
  return { ok: true };
}

// ── Bookings: convert + refunds ──────────────────────────────────────────────
export async function convertWaitlist(bookingId: string, tripId: string): Promise<Result> {
  const user = await requireAdminMfa();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_convert_booking", { p_booking_id: bookingId });
  if (error) return { ok: false, error: error.message };
  const logged = await audit(user, "waitlist_convert", "booking", bookingId, {});
  if (!logged.ok) return logged;
  revalidatePath(`/admin/trips/${tripId}/bookings`);
  return { ok: true };
}

/** The PaymentIntent the deposit (or pay-in-full) charge landed on. */
async function depositIntentId(bookingId: string): Promise<{ ok: true; piId: string | null } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payments")
    .select("stripe_payment_intent_id")
    .eq("booking_id", bookingId)
    .eq("type", "deposit")
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, piId: data?.stripe_payment_intent_id ?? null };
}

/**
 * After the trip: refund the £100 damage deposit (minus any withholding).
 *
 * Real money leaves the account here, so the order of operations is deliberate
 * (audit #7, #9):
 *   1. claim the deposit row with a CONDITIONAL update off status='held' - if it
 *      matches no row, another click or another admin already settled it, and we
 *      stop before Stripe;
 *   2. refund with a stable idempotency key, so a retried invocation gets the
 *      SAME refund back from Stripe rather than a second one;
 *   3. check the error on every write afterwards - a discarded error here means
 *      money moved with nothing recording it.
 * `withheldAmount` is the admin's decision (#50); omitted leaves the row as-is.
 */
export async function refundDamage(bookingId: string, tripId: string, withheldAmount?: number): Promise<Result> {
  const user = await requireAdminMfa();
  const parsedWithheld = pence.optional().safeParse(withheldAmount);
  if (!parsedWithheld.success) return { ok: false, error: "Withholding must be a whole number of pence, zero or more." };
  const admin = createAdminClient();
  const { data: dd, error: ddError } = await admin
    .from("damage_deposits")
    .select("id, amount, withheld_amount, status, stripe_payment_intent_id")
    .eq("booking_id", bookingId)
    .eq("status", "held")
    .maybeSingle();
  if (ddError) return { ok: false, error: ddError.message };
  if (!dd) return { ok: false, error: "No held damage deposit for this booking." };
  const withheld = parsedWithheld.data ?? dd.withheld_amount;
  if (withheld > dd.amount) return { ok: false, error: "The withholding can't be more than the damage deposit." };
  const refundAmount = dd.amount - withheld;
  const settledStatus = withheld > 0 ? "withheld" : "refunded";

  // Resolve the intent BEFORE claiming the row, so a missing one costs nothing
  // to unwind. A fully withheld deposit needs no intent at all.
  let piId: string | null = dd.stripe_payment_intent_id;
  if (refundAmount > 0) {
    if (!piId) {
      const found = await depositIntentId(bookingId);
      if (!found.ok) return found;
      piId = found.piId;
    }
    if (!piId) return { ok: false, error: "No payment intent to refund against." };
  }

  const { data: claimed, error: claimError } = await admin
    .from("damage_deposits")
    .update({ status: settledStatus, withheld_amount: withheld })
    .eq("id", dd.id)
    .eq("status", "held")
    .select("id");
  if (claimError) return { ok: false, error: claimError.message };
  if (!claimed?.length) return { ok: false, error: "This damage deposit has already been settled." };

  // Nothing to send to Stripe when the whole deposit is withheld (#50), and a
  // zero-amount refund would be rejected anyway.
  if (refundAmount === 0 || !piId) {
    const settled = await audit(user, withheld > 0 ? "damage_deposit_withheld" : "damage_deposit_refund", "booking", bookingId, {
      amount: refundAmount,
      withheld_amount: withheld,
    });
    if (!settled.ok) return settled;
    revalidatePath(`/admin/trips/${tripId}/bookings`);
    return { ok: true };
  }

  let refundId: string;
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: piId, amount: refundAmount },
      { idempotencyKey: `dd-refund:${dd.id}` },
    );
    refundId = refund.id;
  } catch (e) {
    const failure = e instanceof Error ? e.message : "Refund failed.";
    if (!stripeRefusedRequest(e)) {
      return { ok: false, error: `${failure} The deposit is marked ${settledStatus} - check Stripe before retrying.` };
    }
    // Stripe refused the call, so no refund exists: hand the deposit back to
    // 'held' and let the admin retry once the cause is fixed.
    const { error: releaseError } = await admin
      .from("damage_deposits")
      .update({ status: "held", withheld_amount: dd.withheld_amount })
      .eq("id", dd.id)
      .eq("status", settledStatus)
      .is("stripe_refund_id", null);
    if (releaseError) {
      return { ok: false, error: `${failure} The deposit is now stuck as ${settledStatus} and needs fixing by hand.` };
    }
    return { ok: false, error: failure };
  }

  const { error: recordError } = await admin
    .from("damage_deposits")
    .update({ refunded_at: new Date().toISOString(), stripe_refund_id: refundId })
    .eq("id", dd.id);
  if (recordError) {
    return { ok: false, error: `Stripe refunded ${formatPence(refundAmount)} but recording it failed: ${recordError.message}` };
  }
  const { error: ledgerError } = await admin.from("payments").insert({
    booking_id: bookingId,
    stripe_payment_intent_id: piId,
    stripe_refund_id: refundId,
    type: "damage_deposit_refund",
    amount: refundAmount,
    status: "succeeded",
  });
  // 23505 = the (intent, type) unique index: an earlier attempt already ledgered
  // this same refund, so the record exists and there is nothing to report.
  if (ledgerError && ledgerError.code !== "23505") {
    return { ok: false, error: `Stripe refunded ${formatPence(refundAmount)} but the ledger write failed: ${ledgerError.message}` };
  }
  const logged = await audit(user, "damage_deposit_refund", "booking", bookingId, { amount: refundAmount, withheld_amount: withheld });
  if (!logged.ok) return logged;
  revalidatePath(`/admin/trips/${tripId}/bookings`);
  return { ok: true };
}

/**
 * Un-converted waitlister: refund the FULL £150 (incl. the £50 downpayment).
 * Same claim-then-refund shape as refundDamage (audit #7).
 */
export async function refundWaitlist(bookingId: string, tripId: string): Promise<Result> {
  const user = await requireAdminMfa();
  const admin = createAdminClient();
  const { data: booking, error: bookingError } = await admin.from("bookings").select("status").eq("id", bookingId).maybeSingle();
  if (bookingError) return { ok: false, error: bookingError.message };
  if (booking?.status !== "waitlisted") return { ok: false, error: "Only waitlisted bookings get the full refund." };
  const found = await depositIntentId(bookingId);
  if (!found.ok) return found;
  const piId = found.piId;
  if (!piId) return { ok: false, error: "No deposit payment to refund." };
  // Refund the amount ACTUALLY captured on that intent (audit #4). A waitlisted
  // pay-in-full booking paid trip cost + £100, not a flat £150 - so sum the
  // succeeded ledger rows tied to this intent rather than a hardcoded deposit.
  const { data: paidRows, error: paidError } = await admin
    .from("payments")
    .select("amount, type")
    .eq("booking_id", bookingId)
    .eq("stripe_payment_intent_id", piId)
    .eq("status", "succeeded")
    .in("type", ["deposit", "damage_deposit_hold", "balance"]);
  if (paidError) return { ok: false, error: paidError.message };
  const refundTotal = (paidRows ?? []).reduce((sum, p) => sum + p.amount, 0);
  if (refundTotal <= 0) return { ok: false, error: "No captured amount to refund." };

  // Claim the booking before touching Stripe: the conditional flip off
  // 'waitlisted' is what stops a second click refunding a second time.
  const { data: claimed, error: claimError } = await admin
    .from("bookings")
    .update({ status: "refunded" })
    .eq("id", bookingId)
    .eq("status", "waitlisted")
    .select("id");
  if (claimError) return { ok: false, error: claimError.message };
  if (!claimed?.length) return { ok: false, error: "This booking has already been refunded." };

  let refundId: string;
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: piId, amount: refundTotal },
      { idempotencyKey: `waitlist-refund:${bookingId}` },
    );
    refundId = refund.id;
  } catch (e) {
    const failure = e instanceof Error ? e.message : "Refund failed.";
    if (!stripeRefusedRequest(e)) {
      return { ok: false, error: `${failure} The booking is marked refunded - check Stripe before retrying.` };
    }
    const { error: releaseError } = await admin
      .from("bookings")
      .update({ status: "waitlisted" })
      .eq("id", bookingId)
      .eq("status", "refunded");
    if (releaseError) {
      return { ok: false, error: `${failure} The booking is now stuck as refunded and needs fixing by hand.` };
    }
    return { ok: false, error: failure };
  }

  const { error: ddError } = await admin
    .from("damage_deposits")
    .update({ status: "refunded", refunded_at: new Date().toISOString(), stripe_refund_id: refundId })
    .eq("booking_id", bookingId)
    .neq("status", "refunded");
  if (ddError) {
    return { ok: false, error: `Stripe refunded ${formatPence(refundTotal)} but recording it failed: ${ddError.message}` };
  }
  const { error: ledgerError } = await admin.from("payments").insert({
    booking_id: bookingId,
    stripe_payment_intent_id: piId,
    stripe_refund_id: refundId,
    type: "waitlist_refund",
    amount: refundTotal,
    status: "succeeded",
  });
  // 23505 as in refundDamage: the row is already there, so nothing is missing.
  if (ledgerError && ledgerError.code !== "23505") {
    return { ok: false, error: `Stripe refunded ${formatPence(refundTotal)} but the ledger write failed: ${ledgerError.message}` };
  }
  const logged = await audit(user, "waitlist_refund", "booking", bookingId, { amount: refundTotal });
  if (!logged.ok) return logged;
  revalidatePath(`/admin/trips/${tripId}/bookings`);
  return { ok: true };
}
