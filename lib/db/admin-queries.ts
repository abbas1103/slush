import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRead, computePaidToTrip, type LedgerRow } from "@/lib/db/queries";
import type { Enums, Tables } from "@/lib/db/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * PostgREST caps every response at max_rows (1000 by default) and says nothing
 * about it, so an unpaged list silently drops rows - and one of these lists is
 * the CSV passenger manifest sent to the coach operator and the resort. Every
 * list read below pages with .range() and refuses to hand back a set that
 * disagrees with the server's exact count. The page size sits under max_rows so
 * a page is never clipped mid-way.
 */
const PAGE_SIZE = 500;

function assertComplete(what: string, fetched: number, expected: number | null): void {
  if (expected !== null && fetched !== expected) {
    throw new Error(`Refusing to show an incomplete ${what}: got ${fetched} of ${expected} rows.`);
  }
}

/** Payment types that represent cash actually captured from the student. */
const CAPTURED_TYPES = ["deposit", "damage_deposit_hold", "balance"];

/**
 * Cash taken and still held for a booking: succeeded deposit + damage-deposit
 * hold + balance rows, less whatever has already been refunded back out. This is
 * exactly what refundWaitlist has to return, so it is the true refund liability -
 * a flat deposit_amount per waitlister understates every waitlister who chose
 * "pay in full" by the whole trip cost.
 */
function capturedTotal(payments: LedgerRow[]): number {
  const taken = payments
    .filter((p) => p.status === "succeeded" && CAPTURED_TYPES.includes(p.type))
    .reduce((sum, p) => sum + p.amount, 0);
  const returned = payments
    .filter(
      (p) =>
        p.status === "succeeded" &&
        (p.type === "waitlist_refund" || p.type === "damage_deposit_refund"),
    )
    .reduce((sum, p) => sum + p.amount, 0);
  return Math.max(0, taken - returned);
}

interface WaitlistLiability {
  count: number;
  exposure: number;
}

/**
 * Every trip's waiting-list count and cash exposure in one grouped read, rather
 * than a head-count request per trip.
 */
async function getWaitlistLiability(admin: AdminClient): Promise<Map<string, WaitlistLiability>> {
  const byTrip = new Map<string, WaitlistLiability>();
  let expected: number | null = null;
  let fetched = 0;

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error, count } = await admin
      .from("bookings")
      .select("trip_id, payments(type, amount, status)", { count: "exact" })
      .eq("status", "waitlisted")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    assertRead(error, "the waiting lists");
    if (expected === null) expected = count;
    const batch = data ?? [];
    for (const b of batch) {
      const entry = byTrip.get(b.trip_id) ?? { count: 0, exposure: 0 };
      entry.count += 1;
      entry.exposure += capturedTotal((b.payments as LedgerRow[]) ?? []);
      byTrip.set(b.trip_id, entry);
    }
    fetched += batch.length;
    if (batch.length < PAGE_SIZE) break;
    if (expected !== null && fetched >= expected) break;
  }
  assertComplete("waiting list", fetched, expected);
  return byTrip;
}

export type AdminTripRow = Tables<"trips"> & {
  waitlistCount: number;
  exposure: number;
};

/** All trips with waitlist count + refund exposure (admin overview). */
export async function getAdminTrips(): Promise<AdminTripRow[]> {
  const admin = createAdminClient();
  const [tripsRes, liability] = await Promise.all([
    admin.from("trips").select("*", { count: "exact" }).order("created_at", { ascending: false }),
    getWaitlistLiability(admin),
  ]);
  assertRead(tripsRes.error, "the trips");
  const trips = tripsRes.data ?? [];
  assertComplete("trip list", trips.length, tripsRes.count);

  return trips.map((t) => {
    const w = liability.get(t.id);
    return { ...t, waitlistCount: w?.count ?? 0, exposure: w?.exposure ?? 0 };
  });
}

export async function getAdminTrip(tripId: string) {
  const admin = createAdminClient();
  const { data: trip, error: tripError } = await admin.from("trips").select("*").eq("id", tripId).maybeSingle();
  assertRead(tripError, "the trip");
  if (!trip) return null;
  const [codesRes, extrasRes] = await Promise.all([
    admin.from("trip_codes").select("*").eq("trip_id", tripId).order("created_at"),
    admin.from("extras").select("*, extra_tiers(*)").eq("trip_id", tripId).order("sort_order"),
  ]);
  assertRead(codesRes.error, "the trip codes");
  assertRead(extrasRes.error, "the trip extras");
  return { trip, codes: codesRes.data ?? [], extras: extrasRes.data ?? [] };
}

export interface AdminBookingRow {
  id: string;
  reference: string;
  status: string;
  studentName: string;
  studentEmail: string;
  tripCost: number;
  paidToTrip: number;
  balance: number;
  damageStatus: string | null;
  createdAt: string;
}

export interface AdminBookingsQuery {
  /** Restrict to one booking status; anything unrecognised is ignored. */
  status?: string;
  /** 1-based page. Omit to read EVERY matching row - what the CSV manifest needs. */
  page?: number;
  /** Rows per page, capped at PAGE_SIZE. */
  pageSize?: number;
}

export interface AdminTripBookings {
  trip: Tables<"trips"> | null;
  rows: AdminBookingRow[];
  /** Exact server-side count of the rows matching the query, paged or not. */
  total: number;
  page: number;
  pageCount: number;
}

const BOOKING_STATUSES: Enums<"booking_status">[] = [
  "pending",
  "confirmed",
  "waitlisted",
  "converted",
  "cancelled",
  "refunded",
];

/**
 * The bookings of one trip, as the admin table and the CSV manifest see them.
 * Pass `page` for a single page (the table); omit it and every matching row is
 * read, or the call fails - a quietly truncated manifest leaves paid students
 * off the coach list.
 */
export async function getAdminTripBookings(
  tripId: string,
  query: AdminBookingsQuery = {},
): Promise<AdminTripBookings> {
  const admin = createAdminClient();
  const { data: trip, error: tripError } = await admin.from("trips").select("*").eq("id", tripId).maybeSingle();
  assertRead(tripError, "the trip");
  if (!trip) return { trip: null, rows: [], total: 0, page: 1, pageCount: 1 };

  // Validate the status here rather than pushing a raw query string at the DB.
  const status = BOOKING_STATUSES.find((s) => s === query.status) ?? null;
  const pageSize = Math.min(Math.max(1, Math.trunc(query.pageSize ?? PAGE_SIZE)), PAGE_SIZE);
  const page = query.page === undefined ? null : Math.max(1, Math.trunc(query.page));

  const build = () => {
    const q = admin
      .from("bookings")
      .select(
        "id, reference, status, created_at, base_price_at_booking, users(first_name, last_name, email), booking_extras(price_at_booking, quantity), payments(type, amount, status), damage_deposits(status, created_at)",
        { count: "exact" },
      )
      .eq("trip_id", tripId);
    const filtered = status ? q.eq("status", status) : q;
    // created_at alone is not a total order; id breaks ties so paging can never
    // skip or repeat a booking.
    return filtered.order("created_at", { ascending: false }).order("id");
  };

  const rows: AdminBookingRow[] = [];
  let total: number | null = null;

  for (let from = page ? (page - 1) * pageSize : 0; ; from += pageSize) {
    const { data, error, count } = await build().range(from, from + pageSize - 1);
    assertRead(error, "the bookings");
    if (total === null) total = count;

    const batch = data ?? [];
    for (const b of batch) {
      const user = b.users as { first_name: string | null; last_name: string | null; email: string } | null;
      const bes = (b.booking_extras as { price_at_booking: number; quantity: number }[]) ?? [];
      const pays = (b.payments as LedgerRow[]) ?? [];
      const dd = (b.damage_deposits as { status: string; created_at: string }[]) ?? [];
      // The price snapshotted when the place was taken, so a later admin price
      // edit cannot reprice a booking that already exists.
      const basePrice = b.base_price_at_booking ?? trip.base_price;
      const tripCost = basePrice + bes.reduce((s, e) => s + e.price_at_booking * e.quantity, 0);
      const paidToTrip = computePaidToTrip(pays, trip.downpayment_amount);
      const terminal = b.status === "cancelled" || b.status === "refunded";
      // Newest damage_deposits row first - that state machine, not the ledger, is
      // the source of truth for whether the £100 is still held.
      const newestDd = [...dd].sort((a, c) => c.created_at.localeCompare(a.created_at)).at(0);
      rows.push({
        id: b.id,
        reference: b.reference,
        status: b.status,
        studentName: `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() || "-",
        studentEmail: user?.email ?? "-",
        tripCost,
        paidToTrip,
        // A dead booking owes nothing. Leaving C - paid here writes a phantom
        // debtor into the finance CSV for every refunded waitlister.
        balance: terminal ? 0 : tripCost - paidToTrip,
        damageStatus: newestDd?.status ?? null,
        createdAt: b.created_at,
      });
    }

    if (page) break;
    if (batch.length < pageSize) break;
    if (total !== null && rows.length >= total) break;
  }

  const totalRows = total ?? rows.length;
  // Unpaged means "the whole list", so a short read is a truncated manifest.
  if (page === null) assertComplete("booking list", rows.length, total);

  return {
    trip,
    rows,
    total: totalRows,
    page: page ?? 1,
    pageCount: page === null ? 1 : Math.max(1, Math.ceil(totalRows / pageSize)),
  };
}
