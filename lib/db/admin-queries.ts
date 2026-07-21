import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/db/types";

/** All trips with waitlist count + refund exposure (admin overview). */
export async function getAdminTrips() {
  const admin = createAdminClient();
  const { data: trips } = await admin.from("trips").select("*").order("created_at", { ascending: false });
  const out = [];
  for (const t of trips ?? []) {
    const { count } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", t.id)
      .eq("status", "waitlisted");
    out.push({ ...t, waitlistCount: count ?? 0, exposure: (count ?? 0) * t.deposit_amount });
  }
  return out;
}

export async function getAdminTrip(tripId: string) {
  const admin = createAdminClient();
  const { data: trip } = await admin.from("trips").select("*").eq("id", tripId).maybeSingle();
  if (!trip) return null;
  const { data: codes } = await admin.from("trip_codes").select("*").eq("trip_id", tripId).order("created_at");
  const { data: extras } = await admin
    .from("extras")
    .select("*, extra_tiers(*)")
    .eq("trip_id", tripId)
    .order("sort_order");
  return { trip, codes: codes ?? [], extras: extras ?? [] };
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

export async function getAdminTripBookings(tripId: string): Promise<{ trip: Tables<"trips"> | null; rows: AdminBookingRow[] }> {
  const admin = createAdminClient();
  const { data: trip } = await admin.from("trips").select("*").eq("id", tripId).maybeSingle();
  if (!trip) return { trip: null, rows: [] };

  const { data: bookings } = await admin
    .from("bookings")
    .select("id, reference, status, created_at, users(first_name, last_name, email), booking_extras(price_at_booking, quantity), payments(type, amount, status), damage_deposits(status)")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });

  const rows: AdminBookingRow[] = (bookings ?? []).map((b) => {
    const user = b.users as { first_name: string | null; last_name: string | null; email: string } | null;
    const bes = (b.booking_extras as { price_at_booking: number; quantity: number }[]) ?? [];
    const pays = (b.payments as { type: string; amount: number; status: string }[]) ?? [];
    const dd = (b.damage_deposits as { status: string }[]) ?? [];
    const tripCost = trip.base_price + bes.reduce((s, e) => s + e.price_at_booking * e.quantity, 0);
    const paidToTrip = pays
      .filter((p) => p.status === "succeeded" && (p.type === "deposit" || p.type === "balance"))
      .reduce((s, p) => s + p.amount, 0);
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      studentName: `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() || "-",
      studentEmail: user?.email ?? "-",
      tripCost,
      paidToTrip,
      balance: tripCost - paidToTrip,
      damageStatus: dd[0]?.status ?? null,
      createdAt: b.created_at,
    };
  });
  return { trip, rows };
}
