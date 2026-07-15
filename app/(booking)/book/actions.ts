"use server";

import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computePricing, type Pricing } from "@/lib/pricing/compute";

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
