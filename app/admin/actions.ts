"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMfa } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import type { Json } from "@/lib/db/types";

type Result = { ok: true } | { ok: false; error: string };

async function audit(action: string, targetType: string, targetId: string, metadata: Json) {
  const admin = createAdminClient();
  const user = await requireAdminMfa();
  await admin.from("audit_log").insert({
    actor_user_id: user.id,
    actor_email: user.email ?? null,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata, // NO PII — refs/amounts/status only
  });
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
  await requireAdminMfa();
  const admin = createAdminClient();
  const row = { ...input, base_inclusions: input.base_inclusions };
  if (tripId) {
    const { error } = await admin.from("trips").update(row).eq("id", tripId);
    if (error) return { ok: false, error: error.message };
    await audit("trip_update", "trip", tripId, { status: input.status, capacity: input.capacity, base_price: input.base_price });
    revalidatePath("/admin");
    revalidatePath(`/admin/trips/${tripId}`);
    return { ok: true, id: tripId };
  }
  const { data, error } = await admin.from("trips").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create trip." };
  await audit("trip_create", "trip", data.id, { status: input.status });
  revalidatePath("/admin");
  return { ok: true, id: data.id };
}

// ── Trip codes ─────────────────────────────────────────────────────────────
export async function addTripCode(tripId: string, code: string): Promise<Result> {
  await requireAdminMfa();
  const admin = createAdminClient();
  const { error } = await admin.from("trip_codes").insert({ trip_id: tripId, code: code.trim(), active: true });
  if (error) return { ok: false, error: error.message };
  await audit("trip_code_add", "trip", tripId, { code: code.trim() });
  revalidatePath(`/admin/trips/${tripId}`);
  return { ok: true };
}

export async function setTripCodeActive(codeId: string, tripId: string, active: boolean): Promise<Result> {
  await requireAdminMfa();
  const admin = createAdminClient();
  const { error } = await admin.from("trip_codes").update({ active }).eq("id", codeId);
  if (error) return { ok: false, error: error.message };
  await audit("trip_code_toggle", "trip_code", codeId, { active });
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
  await requireAdminMfa();
  const admin = createAdminClient();
  if (extraId) {
    const { error } = await admin.from("extras").update(input).eq("id", extraId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from("extras").insert({ ...input, trip_id: tripId });
    if (error) return { ok: false, error: error.message };
  }
  await audit("extra_save", "trip", tripId, { name: input.name, price: input.price, active: input.active });
  revalidatePath(`/admin/trips/${tripId}/extras`);
  revalidatePath(`/trip`);
  return { ok: true };
}

export async function reorderExtras(tripId: string, orderedIds: string[]): Promise<Result> {
  await requireAdminMfa();
  const admin = createAdminClient();
  for (let i = 0; i < orderedIds.length; i++) {
    await admin.from("extras").update({ sort_order: i + 1 }).eq("id", orderedIds[i]);
  }
  revalidatePath(`/admin/trips/${tripId}/extras`);
  return { ok: true };
}

export async function saveTier(tierId: string | null, extraId: string, tripId: string, name: string, price: number, sortOrder: number): Promise<Result> {
  await requireAdminMfa();
  const admin = createAdminClient();
  const row = { extra_id: extraId, name, price, sort_order: sortOrder };
  const { error } = tierId
    ? await admin.from("extra_tiers").update(row).eq("id", tierId)
    : await admin.from("extra_tiers").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/trips/${tripId}/extras`);
  return { ok: true };
}

// ── Bookings: convert + refunds ──────────────────────────────────────────────
export async function convertWaitlist(bookingId: string, tripId: string): Promise<Result> {
  await requireAdminMfa();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_convert_booking", { p_booking_id: bookingId });
  if (error) return { ok: false, error: error.message };
  await audit("waitlist_convert", "booking", bookingId, {});
  revalidatePath(`/admin/trips/${tripId}/bookings`);
  return { ok: true };
}

async function depositIntentId(bookingId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("payments")
    .select("stripe_payment_intent_id")
    .eq("booking_id", bookingId)
    .eq("type", "deposit")
    .limit(1)
    .maybeSingle();
  return data?.stripe_payment_intent_id ?? null;
}

/** After the trip: refund the £100 damage deposit (minus any withholding). */
export async function refundDamage(bookingId: string, tripId: string): Promise<Result> {
  await requireAdminMfa();
  const admin = createAdminClient();
  const { data: dd } = await admin
    .from("damage_deposits")
    .select("id, amount, withheld_amount, status, stripe_payment_intent_id")
    .eq("booking_id", bookingId)
    .eq("status", "held")
    .maybeSingle();
  if (!dd) return { ok: false, error: "No held damage deposit for this booking." };
  const piId = dd.stripe_payment_intent_id ?? (await depositIntentId(bookingId));
  if (!piId) return { ok: false, error: "No payment intent to refund against." };
  const refundAmount = dd.amount - dd.withheld_amount;
  try {
    const refund = await stripe.refunds.create({ payment_intent: piId, amount: refundAmount });
    await admin.from("damage_deposits").update({
      status: dd.withheld_amount > 0 ? "withheld" : "refunded",
      refunded_at: new Date().toISOString(),
      stripe_refund_id: refund.id,
    }).eq("id", dd.id);
    await admin.from("payments").insert({
      booking_id: bookingId,
      stripe_payment_intent_id: piId,
      stripe_refund_id: refund.id,
      type: "damage_deposit_refund",
      amount: refundAmount,
      status: "succeeded",
    });
    await audit("damage_deposit_refund", "booking", bookingId, { amount: refundAmount });
    revalidatePath(`/admin/trips/${tripId}/bookings`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Refund failed." };
  }
}

/** Un-converted waitlister: refund the FULL £150 (incl. the £50 downpayment). */
export async function refundWaitlist(bookingId: string, tripId: string): Promise<Result> {
  await requireAdminMfa();
  const admin = createAdminClient();
  const { data: booking } = await admin.from("bookings").select("status").eq("id", bookingId).maybeSingle();
  if (booking?.status !== "waitlisted") return { ok: false, error: "Only waitlisted bookings get the full refund." };
  const { data: trip } = await admin.from("trips").select("deposit_amount").eq("id", tripId).single();
  const piId = await depositIntentId(bookingId);
  if (!piId) return { ok: false, error: "No deposit payment to refund." };
  try {
    const refund = await stripe.refunds.create({ payment_intent: piId, amount: trip!.deposit_amount });
    await admin.from("bookings").update({ status: "refunded" }).eq("id", bookingId);
    await admin.from("damage_deposits").update({ status: "refunded", refunded_at: new Date().toISOString(), stripe_refund_id: refund.id }).eq("booking_id", bookingId).neq("status", "refunded");
    await admin.from("payments").insert({
      booking_id: bookingId,
      stripe_payment_intent_id: piId,
      stripe_refund_id: refund.id,
      type: "waitlist_refund",
      amount: trip!.deposit_amount,
      status: "succeeded",
    });
    await audit("waitlist_refund", "booking", bookingId, { amount: trip!.deposit_amount });
    revalidatePath(`/admin/trips/${tripId}/bookings`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Refund failed." };
  }
}
