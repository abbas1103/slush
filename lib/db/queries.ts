import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/user";
import type { Enums, Tables } from "@/lib/db/types";
import { computePricing, type Pricing } from "@/lib/pricing/compute";

/**
 * A failed read is not the same as "no rows": swallowed, a Supabase blip shows a
 * student who has just paid an empty dashboard or a bare 404. Throw so the
 * failure is visible (Sentry + the route's error boundary) and keep `null` for a
 * row that genuinely isn't there.
 */
export function assertRead(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Could not load ${what}: ${error.message}`);
}

/**
 * Every trips column EXCEPT capacity and confirmed_count.
 *
 * The brief forbids surfacing a remaining-places number: the trip page shows a
 * boolean "full" from trip_effective_full() and nothing finer. Reading trips with
 * `select("*")` pulled both counters into the RSC payload of every booking and
 * dashboard page, and left a signed-in student able to GET
 * /rest/v1/trips?select=capacity,confirmed_count straight off PostgREST.
 *
 * These are the same 17 columns 20260729000300 grants to `anon`, so a
 * column-level grant can now be applied to `authenticated` too - which is only
 * safe BECAUSE these reads are narrowed: under a column grant, `select("*")`
 * fails outright rather than returning a subset.
 */
export const TRIP_COLUMNS =
  "id, name, organiser, resort, country, start_date, end_date, nights, base_price, base_inclusions, deposit_amount, downpayment_amount, damage_deposit_amount, balance_due_date, description, status, created_at";

/** A trip as the student-facing app may see it: no capacity, no confirmed_count. */
export type PublicTrip = Omit<Tables<"trips">, "capacity" | "confirmed_count">;

/** The payments-ledger fields the money maths needs, whichever query fetched them. */
export interface LedgerRow {
  type: string;
  amount: number;
  status: string;
}

/**
 * Money actually received toward the trip: succeeded deposit + balance payments,
 * minus the trip-applied portion of any waiting-list refund. The one TypeScript
 * implementation - it mirrors the DB's public.booking_trip_paid exactly, and the
 * two must not drift. Without the refund term a fully refunded waitlister still
 * reports £50 paid and a £389 balance owing.
 */
export function computePaidToTrip(payments: LedgerRow[], downpaymentAmount: number): number {
  const received = payments
    .filter((p) => p.status === "succeeded" && (p.type === "deposit" || p.type === "balance"))
    .reduce((sum, p) => sum + p.amount, 0);
  // A waitlist refund returns the whole deposit (£150), of which only the £50
  // downpayment ever counted toward the trip - so unwind at most that much per row.
  const returned = payments
    .filter((p) => p.status === "succeeded" && p.type === "waitlist_refund")
    .reduce((sum, p) => sum + Math.min(p.amount, downpaymentAmount), 0);
  return received - returned;
}

export type ExtraWithTiers = Tables<"extras"> & {
  extra_tiers: Tables<"extra_tiers">[];
};

export interface TripDetail {
  trip: PublicTrip;
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

  const { data: tripId, error: codeError } = await supabase.rpc("redeem_trip_code", {
    p_code: code.trim(),
  });
  assertRead(codeError, "the trip code");
  if (!tripId) return null;

  // All three depend only on tripId, so pay for one round trip, not three.
  const [
    { data: trip, error: tripError },
    { data: extras, error: extrasError },
    { data: isFull, error: fullError },
  ] = await Promise.all([
    supabase.from("trips").select(TRIP_COLUMNS).eq("id", tripId).maybeSingle(),
    supabase
      .from("extras")
      .select("*, extra_tiers(*)")
      .eq("trip_id", tripId)
      .eq("active", true)
      .order("sort_order"),
    supabase.rpc("trip_effective_full", { p_trip_id: tripId }),
  ]);
  assertRead(tripError, "the trip");
  assertRead(extrasError, "the trip extras");
  assertRead(fullError, "trip availability");
  if (!trip) return null;

  const normalised: ExtraWithTiers[] = (extras ?? []).map((e) => ({
    ...e,
    extra_tiers: [...(e.extra_tiers ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    ),
  }));

  return { trip, extras: normalised, isFull: !!isFull };
}

export interface LiveHold {
  bookingId: string;
  isWaitlist: boolean;
  expiresAt: string;
}

/**
 * The current user's live 30-minute hold on a trip, if they have one.
 *
 * The trip page needs this so the reservation panel survives a refresh: it used
 * to live only in client state, so reloading dropped the countdown and left the
 * student with no way to see or release a place they were still holding.
 *
 * `expires_at > now()` is load-bearing, not decorative: expiry is a lazy status
 * change (pg_cron sweeps every minute, start_booking sweeps inline), so an
 * 'active' row can already be past its expiry.
 *
 * At most one row can match - holds_one_active_per_user_trip is a partial unique
 * index on (trip_id, user_id) where status = 'active' - so maybeSingle() is safe.
 */
export async function getMyLiveHold(tripId: string): Promise<LiveHold | null> {
  const [supabase, user] = await Promise.all([createClient(), getUser()]);
  if (!user) return null;

  // Filter on user_id explicitly, as everywhere else here: the RLS policy is
  // `user_id = auth.uid() OR is_admin_mfa()`, so an admin session would
  // otherwise match every student's hold on this trip.
  const { data, error } = await supabase
    .from("holds")
    .select("booking_id, is_waitlist, expires_at")
    .eq("user_id", user.id)
    .eq("trip_id", tripId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  assertRead(error, "your reservation");

  if (!data?.booking_id) return null;
  return {
    bookingId: data.booking_id,
    isWaitlist: data.is_waitlist,
    expiresAt: data.expires_at,
  };
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
    | "id"
    | "trip_id"
    | "status"
    | "reference"
    | "insurance_choice"
    | "insurance_details"
    | "access_needs"
    | "base_price_at_booking"
  >;
  trip: PublicTrip;
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
  // Request-cached, so a layout's guard has usually already paid for this and it
  // costs nothing here (lib/auth/user.ts). Still a verified read, not getSession().
  const [supabase, user] = await Promise.all([createClient(), getUser()]);
  if (!user) return null;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, trip_id, status, reference, insurance_choice, insurance_details, access_needs, base_price_at_booking",
    )
    .eq("id", bookingId)
    // Filter on ownership rather than leaning on RLS alone. This row carries the
    // insurance declaration and the encrypted access/medical needs, and an admin
    // policy spans every booking - so an MFA'd admin session hitting a checkout
    // URL would otherwise read another student's Article 9 data. Same defect
    // class as getMyBooking below: RLS is the backstop, not the filter.
    .eq("user_id", user.id)
    .maybeSingle();
  assertRead(bookingError, "your booking");
  if (!booking) return null;

  // All three depend only on the booking we already have.
  const [
    { data: trip, error: tripError },
    { data: extras, error: extrasError },
    { data: selected, error: selectedError },
  ] = await Promise.all([
    supabase.from("trips").select(TRIP_COLUMNS).eq("id", booking.trip_id).maybeSingle(),
    supabase
      .from("extras")
      .select("*, extra_tiers(*)")
      .eq("trip_id", booking.trip_id)
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("booking_extras")
      .select("extra_id, extra_tier_id, price_at_booking, quantity")
      .eq("booking_id", bookingId),
  ]);
  assertRead(tripError, "your trip");
  assertRead(extrasError, "the trip extras");
  assertRead(selectedError, "your selected extras");
  if (!trip) return null;

  const normalised: ExtraWithTiers[] = (extras ?? []).map((e) => ({
    ...e,
    extra_tiers: [...(e.extra_tiers ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));

  return { booking, trip, extras: normalised, selected: selected ?? [] };
}

export interface PaymentRow extends LedgerRow {
  created_at: string;
}

export interface MyBooking {
  booking: Pick<Tables<"bookings">, "id" | "status" | "reference" | "trip_id" | "created_at">;
  trip: PublicTrip;
  pricing: Pricing;
  paidToTrip: number;
  balance: number;
  damageHeld: boolean;
  damageStatus: string | null;
  payments: PaymentRow[];
  selectedExtras: { type: string; name: string }[];
  /**
   * The booking is over (refunded): it is kept on screen as a record and a
   * refund receipt, so the UI must show a terminal state and must never ask for
   * money or unlock tickets.
   */
  isTerminal: boolean;
}

/** Statuses where the booking is still alive - it holds, or is queuing for, a place. */
const LIVE_STATUSES: Enums<"booking_status">[] = ["pending", "confirmed", "waitlisted", "converted"];

/**
 * The current user's booking with everything the dashboard + tickets need.
 * Returns null if they have none.
 */
export async function getMyBooking(): Promise<MyBooking | null> {
  // See getBookingContext: request-cached verified read, usually already resolved
  // by the (dashboard) layout's requireUser().
  const [supabase, user] = await Promise.all([createClient(), getUser()]);
  if (!user) return null;

  // Filter on user_id explicitly. RLS is defence in depth here, not the filter:
  // its policy is `user_id = auth.uid() OR is_admin()`, so for an admin session
  // it matches every student's booking and the newest one would be rendered as
  // the admin's own - QR tickets included.
  // 'refunded' is included so a refunded waitlister keeps their booking record
  // and their refund receipt; 'cancelled' is not, because that is the hold
  // sweeper's state for an abandoned checkout where no money ever moved.
  const { data: candidates, error: bookingError } = await supabase
    .from("bookings")
    .select("id, user_id, status, reference, trip_id, created_at, base_price_at_booking")
    .eq("user_id", user.id)
    .in("status", [...LIVE_STATUSES, "refunded"])
    .order("created_at", { ascending: false })
    .limit(20);
  assertRead(bookingError, "your booking");

  const rows = candidates ?? [];
  // A live booking always wins; a refunded one only shows when there is none,
  // so a fresh booking is never shadowed by an old refunded row.
  const booking = rows.find((b) => LIVE_STATUSES.includes(b.status)) ?? rows.at(0) ?? null;
  if (!booking || booking.user_id !== user.id) return null;

  const [
    { data: trip, error: tripError },
    { data: bes, error: besError },
    { data: payments, error: paymentsError },
    { data: dd, error: ddError },
  ] = await Promise.all([
    supabase.from("trips").select(TRIP_COLUMNS).eq("id", booking.trip_id).maybeSingle(),
    supabase
      .from("booking_extras")
      .select("price_at_booking, quantity, extras(name, type), extra_tiers(name)")
      .eq("booking_id", booking.id),
    supabase
      .from("payments")
      .select("type, amount, status, created_at")
      .eq("booking_id", booking.id)
      .order("created_at"),
    // Damage status comes from the damage_deposits state machine (source of truth),
    // not the ledger row - so it flips to 'refunded' after the admin returns it.
    supabase
      .from("damage_deposits")
      .select("status")
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  assertRead(tripError, "your trip");
  assertRead(besError, "your extras");
  assertRead(paymentsError, "your payment history");
  assertRead(ddError, "your damage deposit");
  if (!trip) return null;

  const lineItems = (bes ?? []).map((b) => {
    const extra = b.extras as { name: string; type: string } | null;
    const tier = b.extra_tiers as { name: string } | null;
    return {
      label: `${extra?.name ?? "Extra"}${tier ? ` - ${tier.name}` : ""}`,
      amount: b.price_at_booking * b.quantity,
    };
  });
  const pricing = computePricing({
    // The price snapshotted when the place was taken, so a later admin price
    // edit cannot reprice a booking that already exists (mirrors the DB's
    // coalesce(b.base_price_at_booking, t.base_price)).
    basePrice: booking.base_price_at_booking ?? trip.base_price,
    depositAmount: trip.deposit_amount,
    downpaymentAmount: trip.downpayment_amount,
    damageDepositAmount: trip.damage_deposit_amount,
    extras: lineItems,
  });
  const paidToTrip = computePaidToTrip(payments ?? [], trip.downpayment_amount);
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
    isTerminal: booking.status === "refunded",
  };
}
