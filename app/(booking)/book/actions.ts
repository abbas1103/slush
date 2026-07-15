"use server";

import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computePricing, type Pricing } from "@/lib/pricing/compute";
import { encryptPII } from "@/lib/crypto/pii";
import { detailsSchema, type DetailsInput } from "@/lib/validation/details";
import { stripe } from "@/lib/stripe/server";
import { rateLimit } from "@/lib/ratelimit";

type AuthResult = { ok: true; user: User } | { ok: false; error: string };

async function getVerifiedUser(): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please log in to continue." };
  if (!user.email_confirmed_at) return { ok: false, error: "Please confirm your email first." };
  return { ok: true, user };
}

// ── Start a booking (create hold + pending booking) ──────────────────────────
export type StartResult =
  | { ok: true; bookingId: string; isWaitlist: boolean; expiresAt: string }
  | { ok: false; error: string };

export async function startBooking(code: string): Promise<StartResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_booking", { p_code: code.trim() });
  if (error) return { ok: false, error: error.message };
  const row = data?.[0];
  if (!row) return { ok: false, error: "Could not start your booking." };
  return {
    ok: true,
    bookingId: row.booking_id,
    isWaitlist: row.is_waitlist,
    expiresAt: row.expires_at,
  };
}

export async function releaseHold(bookingId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("release_hold", { p_booking_id: bookingId });
}

// ── Update extras (server recomputes + snapshots prices) ─────────────────────
export interface ExtrasSelectionInput {
  extraIds: string[];
  tiers: Record<string, string>; // extraId -> tierId (for tier-priced extras)
}

export type UpdateExtrasResult =
  | { ok: true; pricing: Pricing }
  | { ok: false; error: string };

export async function updateExtras(
  bookingId: string,
  selection: ExtrasSelectionInput,
): Promise<UpdateExtrasResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select("id, user_id, trip_id, status, payment_intent_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.user_id !== auth.user.id) {
    return { ok: false, error: "Booking not found." };
  }
  if (booking.status !== "pending") {
    return { ok: false, error: "This booking can no longer be edited." };
  }
  // Extras lock: once a payable intent exists, the amount is committed. Editing
  // extras here would let the charge and the recorded cost diverge (audit #1/#9).
  if (booking.payment_intent_id) {
    return { ok: false, error: "Payment has started — start over to change your extras." };
  }

  const { data: trip } = await admin
    .from("trips")
    .select("base_price, deposit_amount, downpayment_amount, damage_deposit_amount")
    .eq("id", booking.trip_id)
    .single();
  const { data: catalogue } = await admin
    .from("extras")
    .select("id, name, type, price, price_tbc, has_quality_tiers, single_select_group, active, extra_tiers(id, name, price)")
    .eq("trip_id", booking.trip_id);

  const byId = new Map((catalogue ?? []).map((e) => [e.id, e]));
  const rows: {
    booking_id: string;
    extra_id: string;
    extra_tier_id: string | null;
    quantity: number;
    price_at_booking: number;
  }[] = [];
  const seenGroups = new Set<string>();

  for (const id of selection.extraIds) {
    const ex = byId.get(id);
    if (!ex || !ex.active) return { ok: false, error: "Invalid extra selected." };
    if (ex.type === "other") continue; // insurance cover is managed on the details step
    if (ex.single_select_group) {
      if (seenGroups.has(ex.single_select_group)) {
        return { ok: false, error: "Only one option can be selected per group." };
      }
      seenGroups.add(ex.single_select_group);
    }

    let price: number;
    let tierId: string | null = null;
    if (ex.has_quality_tiers) {
      tierId = selection.tiers[id] ?? null;
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

  // Replace only the non-insurance extras (leave any 'other' cover row intact).
  const nonOtherIds = (catalogue ?? []).filter((e) => e.type !== "other").map((e) => e.id);
  await admin.from("booking_extras").delete().eq("booking_id", bookingId).in("extra_id", nonOtherIds);
  if (rows.length) {
    const { error } = await admin.from("booking_extras").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  // Recompute the total from ALL current booking extras (so a preserved
  // insurance-cover row is still counted), with labels for the sidebar.
  const { data: current } = await admin
    .from("booking_extras")
    .select("price_at_booking, quantity, extras(name), extra_tiers(name)")
    .eq("booking_id", bookingId);
  const finalLineItems = (current ?? []).map((row) => {
    const extra = row.extras as { name: string } | null;
    const tier = row.extra_tiers as { name: string } | null;
    return {
      label: `${extra?.name ?? "Extra"}${tier ? ` — ${tier.name}` : ""}`,
      amount: row.price_at_booking * row.quantity,
    };
  });

  const pricing = computePricing({
    basePrice: trip!.base_price,
    depositAmount: trip!.deposit_amount,
    downpaymentAmount: trip!.downpayment_amount,
    damageDepositAmount: trip!.damage_deposit_amount,
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
  const { data: booking } = await admin
    .from("bookings")
    .select("id, user_id, trip_id, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.user_id !== auth.user.id) return { ok: false, error: "Booking not found." };
  if (booking.status !== "pending") return { ok: false, error: "This booking can no longer be edited." };

  const { data: trip } = await admin
    .from("trips")
    .select("start_date")
    .eq("id", booking.trip_id)
    .single();

  // 18+ on arrival
  const start = new Date(`${trip!.start_date}T00:00:00`);
  const dob = new Date(`${d.dob}T00:00:00`);
  let age = start.getFullYear() - dob.getFullYear();
  const monthDiff = start.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && start.getDate() < dob.getDate())) age--;
  // Reject unparseable DOB too: NaN < 18 is false, which would silently skip
  // the gate (audit #4). details.ts also validates the calendar date.
  if (!Number.isFinite(age) || age < 18) {
    return { ok: false, error: "You must be 18 or over on arrival in resort." };
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
  if (userErr) return { ok: false, error: userErr.message };

  // Emergency contact (single primary): replace
  await admin.from("emergency_contacts").delete().eq("user_id", auth.user.id);
  await admin.from("emergency_contacts").insert({
    user_id: auth.user.id,
    // Non-null: detailsSchema requires non-empty name/phone, so the cipher is
    // always a string (encryptPII only returns null for empty/null input).
    full_name: encryptPII(d.emergencyName)!,
    relationship: d.emergencyRelationship || null,
    phone: encryptPII(d.emergencyPhone)!,
  });

  // Booking: insurance choice + encrypted policy/access-needs
  const insuranceDetails =
    d.insuranceChoice === "own"
      ? { insurer: d.insurer, policy: encryptPII(d.policyNumber), emergency_line: d.insuranceEmergencyLine }
      : null;
  await admin
    .from("bookings")
    .update({
      insurance_choice: d.insuranceChoice,
      insurance_details: insuranceDetails,
      access_needs: encryptPII(d.accessNeeds || null),
    })
    .eq("id", bookingId);

  // Consents (one record per booking): replace, no pre-ticked boxes
  await admin.from("consents").delete().eq("booking_id", bookingId);
  await admin.from("consents").insert({
    user_id: auth.user.id,
    booking_id: bookingId,
    terms_version: "v1",
    terms_accepted_at: nowIso,
    marketing_opt_in: d.marketingOptIn,
    marketing_opt_in_at: d.marketingOptIn ? nowIso : null,
    health_data_consent: !!d.accessNeeds,
    health_data_consent_at: d.accessNeeds ? nowIso : null,
    share_access_needs_with_resort: d.shareAccessNeeds,
    share_access_needs_at: d.shareAccessNeeds ? nowIso : null,
  });

  // Insurance cover extra (type 'other'): add if bought, remove if own
  const { data: cover } = await admin
    .from("extras")
    .select("id, price")
    .eq("trip_id", booking.trip_id)
    .eq("type", "other")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (cover) {
    await admin.from("booking_extras").delete().eq("booking_id", bookingId).eq("extra_id", cover.id);
    if (d.insuranceChoice === "bought" && cover.price != null) {
      await admin.from("booking_extras").insert({
        booking_id: bookingId,
        extra_id: cover.id,
        quantity: 1,
        price_at_booking: cover.price,
      });
    }
  }

  return { ok: true };
}

// ── Create a PaymentIntent (amount recomputed server-side; never trusted) ────
export type IntentResult =
  | { ok: true; clientSecret: string; amount: number }
  | { ok: false; error: string };

async function bookingPricing(bookingId: string, tripId: string) {
  const admin = createAdminClient();
  const { data: trip } = await admin
    .from("trips")
    .select("base_price, deposit_amount, downpayment_amount, damage_deposit_amount")
    .eq("id", tripId)
    .single();
  const { data: bes } = await admin
    .from("booking_extras")
    .select("price_at_booking, quantity")
    .eq("booking_id", bookingId);
  return computePricing({
    basePrice: trip!.base_price,
    depositAmount: trip!.deposit_amount,
    downpaymentAmount: trip!.downpayment_amount,
    damageDepositAmount: trip!.damage_deposit_amount,
    extras: (bes ?? []).map((b) => ({ label: "", amount: b.price_at_booking * b.quantity })),
  });
}

const PaymentMode = z.enum(["deposit", "full"]);
// PaymentIntent statuses whose client_secret is still usable to complete a charge.
const REUSABLE_PI = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
]);

export async function createPaymentIntent(
  bookingId: string,
  mode: "deposit" | "full",
): Promise<IntentResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!(await rateLimit("payment", auth.user.id))) return { ok: false, error: "Too many attempts — please wait a moment." };

  // The mode string becomes the ledger's payment_kind — never trust it raw.
  const parsedMode = PaymentMode.safeParse(mode);
  if (!parsedMode.success) return { ok: false, error: "Invalid payment option." };
  const payMode = parsedMode.data;

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, user_id, trip_id, status, reference, payment_intent_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.user_id !== auth.user.id) return { ok: false, error: "Booking not found." };
  if (booking.status !== "pending") return { ok: false, error: "This booking is no longer payable." };

  // Amount is computed from the DB — the browser never sends it.
  const pricing = await bookingPricing(bookingId, booking.trip_id);
  const amount = payMode === "deposit" ? pricing.depositToday : pricing.payInFullToday;

  try {
    // One live deposit/full intent per booking (audit #9). Reuse the existing
    // intent on a reload/in-flight auth (same amount, still completable); on a
    // mode switch (amount changed) cancel it first so two intents can't both be
    // confirmed and double-charge the customer.
    if (booking.payment_intent_id) {
      const existing = await stripe.paymentIntents.retrieve(booking.payment_intent_id).catch(() => null);
      if (existing && REUSABLE_PI.has(existing.status) && existing.amount === amount) {
        return { ok: true, clientSecret: existing.client_secret!, amount };
      }
      if (existing && REUSABLE_PI.has(existing.status)) {
        await stripe.paymentIntents.cancel(existing.id).catch(() => {});
      }
    }

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: "gbp",
      automatic_payment_methods: { enabled: true },
      metadata: {
        booking_id: bookingId,
        trip_id: booking.trip_id,
        payment_kind: payMode,
        reference: booking.reference,
      },
    });
    if (!intent.client_secret) return { ok: false, error: "Could not initialise payment." };
    // Record the single live intent so updateExtras can lock and a later call
    // knows which one to reuse/cancel. Cleared in the finalize RPC on success.
    await admin.from("bookings").update({ payment_intent_id: intent.id }).eq("id", bookingId);
    return { ok: true, clientSecret: intent.client_secret, amount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Payment setup failed." };
  }
}

// ── Balance payment intent (amount clamped server-side to [£1, outstanding]) ──
export async function createBalancePaymentIntent(
  bookingId: string,
  requestedAmount: number,
): Promise<IntentResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!(await rateLimit("payment", auth.user.id))) return { ok: false, error: "Too many attempts — please wait a moment." };

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, user_id, trip_id, status, reference")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.user_id !== auth.user.id) return { ok: false, error: "Booking not found." };
  if (booking.status !== "confirmed" && booking.status !== "converted") {
    return { ok: false, error: "Balance payments open once your place is confirmed." };
  }

  const pricing = await bookingPricing(bookingId, booking.trip_id);
  const { data: pays } = await admin
    .from("payments")
    .select("type, amount, status")
    .eq("booking_id", bookingId);
  const paidToTrip = (pays ?? [])
    .filter((p) => p.status === "succeeded" && (p.type === "deposit" || p.type === "balance"))
    .reduce((sum, p) => sum + p.amount, 0);
  const balance = pricing.tripCost - paidToTrip;
  if (balance <= 0) return { ok: false, error: "Your balance is already cleared." };

  // Clamp to what's owed — NEVER charge more than the outstanding balance
  // (audit #6: the old £1 floor applied last could overcharge a sub-£1 balance).
  const parsedReq = z.number().int().positive().safeParse(Math.round(requestedAmount));
  if (!parsedReq.success) return { ok: false, error: "Enter a valid amount." };
  const amount = Math.min(parsedReq.data, balance);
  const STRIPE_MIN_GBP = 30; // Stripe's minimum GBP charge is £0.30
  if (amount < STRIPE_MIN_GBP) {
    return balance < STRIPE_MIN_GBP
      ? { ok: false, error: "Your remaining balance is under £0.30 — please contact us to settle it." }
      : { ok: false, error: "The minimum card payment is £0.30." };
  }

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: "gbp",
        automatic_payment_methods: { enabled: true },
        metadata: {
          booking_id: bookingId,
          trip_id: booking.trip_id,
          payment_kind: "balance",
          reference: booking.reference,
        },
      },
      // Idempotency-Key (audit #8). Minute-bucketed so a lost-response retry
      // dedupes, without colliding across genuinely separate top-ups.
      { idempotencyKey: `bal:${bookingId}:${amount}:${Math.floor(Date.now() / 60000)}` },
    );
    if (!intent.client_secret) return { ok: false, error: "Could not initialise payment." };
    return { ok: true, clientSecret: intent.client_secret, amount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Payment setup failed." };
  }
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
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return { ok: false };

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, user_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.user_id !== auth.user.id) return { ok: false };

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
      await admin.rpc("record_payment_and_finalize", {
        p_booking_id: bookingId,
        p_intent_id: pi.id,
        p_charge_id: charge,
        p_kind: kind,
        p_amount_total: pi.amount,
      });
    }
  }
  return { ok: true, status: pi.status };
}
