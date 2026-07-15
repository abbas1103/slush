"use server";

import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computePricing, type Pricing } from "@/lib/pricing/compute";
import { encryptPII } from "@/lib/crypto/pii";
import { detailsSchema, type DetailsInput } from "@/lib/validation/details";
import { stripe } from "@/lib/stripe/server";

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
    .select("id, user_id, trip_id, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.user_id !== auth.user.id) {
    return { ok: false, error: "Booking not found." };
  }
  if (booking.status !== "pending") {
    return { ok: false, error: "This booking can no longer be edited." };
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
  if (age < 18) return { ok: false, error: "You must be 18 or over on arrival in resort." };

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
      dob: d.dob,
      nationality: d.nationality,
      passport_number: encryptPII(d.passportNumber),
      phone: d.phone,
    })
    .eq("id", auth.user.id);
  if (userErr) return { ok: false, error: userErr.message };

  // Emergency contact (single primary): replace
  await admin.from("emergency_contacts").delete().eq("user_id", auth.user.id);
  await admin.from("emergency_contacts").insert({
    user_id: auth.user.id,
    full_name: d.emergencyName,
    relationship: d.emergencyRelationship || null,
    phone: d.emergencyPhone,
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

export async function createPaymentIntent(
  bookingId: string,
  mode: "deposit" | "full",
): Promise<IntentResult> {
  const auth = await getVerifiedUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, user_id, trip_id, status, reference")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.user_id !== auth.user.id) return { ok: false, error: "Booking not found." };
  if (booking.status !== "pending") return { ok: false, error: "This booking is no longer payable." };

  // Amount is computed from the DB — the browser never sends it.
  const pricing = await bookingPricing(bookingId, booking.trip_id);
  const amount = mode === "deposit" ? pricing.depositToday : pricing.payInFullToday;

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: "gbp",
        automatic_payment_methods: { enabled: true },
        metadata: {
          booking_id: bookingId,
          trip_id: booking.trip_id,
          payment_kind: mode,
          reference: booking.reference,
        },
      },
      { idempotencyKey: `pi:${bookingId}:${mode}:${amount}` },
    );
    if (!intent.client_secret) return { ok: false, error: "Could not initialise payment." };
    return { ok: true, clientSecret: intent.client_secret, amount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Payment setup failed." };
  }
}
