import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/db/types";
import { computePricing, type Pricing } from "@/lib/pricing/compute";

export type ExtraWithTiers = Tables<"extras"> & {
  extra_tiers: Tables<"extra_tiers">[];
};

export interface TripDetail {
  trip: Tables<"trips">;
  extras: ExtraWithTiers[];
  isFull: boolean;
}

/**
 * Resolve a trip code to its full detail (trip + active extras + tiers +
 * effective-full flag). Runs as the logged-in user; RLS lets them read the live
 * trip and its active extras. The trip_codes table itself stays hidden - the
 * code is resolved via the redeem_trip_code RPC. Returns null if the code is
 * invalid/inactive or the trip isn't live.
 */
export async function getTripByCode(code: string): Promise<TripDetail | null> {
  const supabase = await createClient();

  const { data: tripId } = await supabase.rpc("redeem_trip_code", {
    p_code: code.trim(),
  });
  if (!tripId) return null;

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) return null;

  const { data: extras } = await supabase
    .from("extras")
    .select("*, extra_tiers(*)")
    .eq("trip_id", tripId)
    .eq("active", true)
    .order("sort_order");

  const { data: isFull } = await supabase.rpc("trip_effective_full", {
    p_trip_id: tripId,
  });

  const normalised: ExtraWithTiers[] = (extras ?? []).map((e) => ({
    ...e,
    extra_tiers: [...(e.extra_tiers ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    ),
  }));

  return { trip, extras: normalised, isFull: !!isFull };
}

export interface SelectedExtra {
  extra_id: string;
  extra_tier_id: string | null;
  price_at_booking: number;
  quantity: number;
}

export interface BookingContext {
  booking: Pick<
    Tables<"bookings">,
    "id" | "trip_id" | "status" | "reference" | "insurance_choice" | "access_needs"
  >;
  trip: Tables<"trips">;
  extras: ExtraWithTiers[];
  selected: SelectedExtra[];
}

/**
 * Load a booking the current user owns (via RLS) plus its trip, the active extra
 * catalogue, and the current selections. Read-only - used by the extras/details
 * pages. Returns null if the booking isn't the user's or doesn't exist.
 */
export async function getBookingContext(
  bookingId: string,
): Promise<BookingContext | null> {
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, trip_id, status, reference, insurance_choice, access_needs")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return null;

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", booking.trip_id)
    .maybeSingle();
  if (!trip) return null;

  const { data: extras } = await supabase
    .from("extras")
    .select("*, extra_tiers(*)")
    .eq("trip_id", booking.trip_id)
    .eq("active", true)
    .order("sort_order");

  const { data: selected } = await supabase
    .from("booking_extras")
    .select("extra_id, extra_tier_id, price_at_booking, quantity")
    .eq("booking_id", bookingId);

  const normalised: ExtraWithTiers[] = (extras ?? []).map((e) => ({
    ...e,
    extra_tiers: [...(e.extra_tiers ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));

  return { booking, trip, extras: normalised, selected: selected ?? [] };
}

export interface PaymentRow {
  type: string;
  amount: number;
  status: string;
  created_at: string;
}

export interface MyBooking {
  booking: Pick<Tables<"bookings">, "id" | "status" | "reference" | "trip_id" | "created_at">;
  trip: Tables<"trips">;
  pricing: Pricing;
  paidToTrip: number;
  balance: number;
  damageHeld: boolean;
  damageStatus: string | null;
  payments: PaymentRow[];
  selectedExtras: { type: string; name: string }[];
}

/**
 * The current user's active booking with everything the dashboard + tickets
 * need. RLS restricts to the user's own rows. Returns null if they have none.
 */
export async function getMyBooking(): Promise<MyBooking | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, reference, trip_id, created_at")
    .in("status", ["pending", "confirmed", "waitlisted", "converted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!booking) return null;

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", booking.trip_id)
    .maybeSingle();
  if (!trip) return null;

  const { data: bes } = await supabase
    .from("booking_extras")
    .select("price_at_booking, quantity, extras(name, type), extra_tiers(name)")
    .eq("booking_id", booking.id);
  const { data: payments } = await supabase
    .from("payments")
    .select("type, amount, status, created_at")
    .eq("booking_id", booking.id)
    .order("created_at");

  const lineItems = (bes ?? []).map((b) => {
    const extra = b.extras as { name: string; type: string } | null;
    const tier = b.extra_tiers as { name: string } | null;
    return {
      label: `${extra?.name ?? "Extra"}${tier ? ` - ${tier.name}` : ""}`,
      amount: b.price_at_booking * b.quantity,
    };
  });
  const pricing = computePricing({
    basePrice: trip.base_price,
    depositAmount: trip.deposit_amount,
    downpaymentAmount: trip.downpayment_amount,
    damageDepositAmount: trip.damage_deposit_amount,
    extras: lineItems,
  });
  const paidToTrip = (payments ?? [])
    .filter((p) => p.status === "succeeded" && (p.type === "deposit" || p.type === "balance"))
    .reduce((sum, p) => sum + p.amount, 0);
  // Damage status comes from the damage_deposits state machine (source of truth),
  // not the ledger row - so it flips to 'refunded' after the admin returns it.
  const { data: dd } = await supabase
    .from("damage_deposits")
    .select("status")
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const damageStatus = dd?.status ?? null;
  const damageHeld = damageStatus === "held";
  const selectedExtras = (bes ?? []).map((b) => {
    const extra = b.extras as { name: string; type: string } | null;
    return { type: extra?.type ?? "", name: extra?.name ?? "" };
  });

  return {
    booking,
    trip,
    pricing,
    paidToTrip,
    balance: pricing.tripCost - paidToTrip,
    damageHeld,
    damageStatus,
    payments: payments ?? [],
    selectedExtras,
  };
}
