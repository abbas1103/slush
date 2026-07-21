"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdminMfa } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
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

async function audit(action: string, targetType: string, targetId: string, metadata: Json) {
  const admin = createAdminClient();
  const user = await requireAdminMfa();
  await admin.from("audit_log").insert({
    actor_user_id: user.id,
    actor_email: user.email ?? null,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata, // NO PII - refs/amounts/status only
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
  const parsed = tripInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid trip data." };
  const admin = createAdminClient();
  const row = parsed.data;
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
  const parsed = z.string().trim().min(3).max(64).safeParse(code);
  if (!parsed.success) return { ok: false, error: "Code must be 3–64 characters." };
  const admin = createAdminClient();
  const { error } = await admin.from("trip_codes").insert({ trip_id: tripId, code: parsed.data, active: true });
  if (error) return { ok: false, error: error.message };
  await audit("trip_code_add", "trip", tripId, { code: parsed.data });
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
  const parsed = extraInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid extra data." };
  const data = parsed.data;
  const admin = createAdminClient();
  if (extraId) {
    const { error } = await admin.from("extras").update(data).eq("id", extraId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from("extras").insert({ ...data, trip_id: tripId });
    if (error) return { ok: false, error: error.message };
  }
  await audit("extra_save", "trip", tripId, { name: data.name, price: data.price, active: data.active });
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
  const parsed = z
    .object({ name: z.string().min(1).max(120), price: pence, sortOrder: z.number().int().nonnegative() })
    .safeParse({ name, price, sortOrder });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid tier data." };
  const admin = createAdminClient();
  const row = { extra_id: extraId, name: parsed.data.name, price: parsed.data.price, sort_order: parsed.data.sortOrder };
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
  const piId = await depositIntentId(bookingId);
  if (!piId) return { ok: false, error: "No deposit payment to refund." };
  // Refund the amount ACTUALLY captured on that intent (audit #4). A waitlisted
  // pay-in-full booking paid trip cost + £100, not a flat £150 - so sum the
  // succeeded ledger rows tied to this intent rather than a hardcoded deposit.
  const { data: paidRows } = await admin
    .from("payments")
    .select("amount, type")
    .eq("booking_id", bookingId)
    .eq("stripe_payment_intent_id", piId)
    .eq("status", "succeeded")
    .in("type", ["deposit", "damage_deposit_hold", "balance"]);
  const refundTotal = (paidRows ?? []).reduce((sum, p) => sum + p.amount, 0);
  if (refundTotal <= 0) return { ok: false, error: "No captured amount to refund." };
  try {
    const refund = await stripe.refunds.create({ payment_intent: piId, amount: refundTotal });
    await admin.from("bookings").update({ status: "refunded" }).eq("id", bookingId);
    await admin.from("damage_deposits").update({ status: "refunded", refunded_at: new Date().toISOString(), stripe_refund_id: refund.id }).eq("booking_id", bookingId).neq("status", "refunded");
    await admin.from("payments").insert({
      booking_id: bookingId,
      stripe_payment_intent_id: piId,
      stripe_refund_id: refund.id,
      type: "waitlist_refund",
      amount: refundTotal,
      status: "succeeded",
    });
    await audit("waitlist_refund", "booking", bookingId, { amount: refundTotal });
    revalidatePath(`/admin/trips/${tripId}/bookings`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Refund failed." };
  }
}
