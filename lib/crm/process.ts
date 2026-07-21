import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPII } from "@/lib/crypto/pii";
import { getCrmAdapter } from "./adapters";

/**
 * Drain the CRM outbox: for each pending/failed event, build the contact +
 * booking payload and push via the configured adapter, marking sent/failed.
 * Idempotent at the CRM (upsert by external id / reference). Run on a schedule.
 */
export async function processCrmOutbox(limit = 25): Promise<{ total: number; sent: number; failed: number }> {
  const admin = createAdminClient();
  const adapter = getCrmAdapter();

  const { data: events } = await admin
    .from("crm_outbox")
    .select("*")
    .in("status", ["pending", "failed"])
    .lt("attempts", 5)
    .order("created_at")
    .limit(limit);

  let sent = 0;
  let failed = 0;

  for (const ev of events ?? []) {
    try {
      const { data: b } = await admin
        .from("bookings")
        .select("id, reference, status, trip_id, user_id, users(email, first_name, last_name, phone, university_society), booking_extras(price_at_booking, quantity), payments(type, amount, status)")
        .eq("id", ev.entity_id)
        .maybeSingle();

      if (b) {
        const { data: trip } = await admin
          .from("trips")
          .select("name, base_price, start_date, end_date")
          .eq("id", b.trip_id)
          .single();
        const user = b.users as { email: string; first_name: string | null; last_name: string | null; phone: string | null; university_society: string | null } | null;
        const bes = (b.booking_extras as { price_at_booking: number; quantity: number }[]) ?? [];
        const pays = (b.payments as { type: string; amount: number; status: string }[]) ?? [];
        const tripCost = (trip?.base_price ?? 0) + bes.reduce((s, e) => s + e.price_at_booking * e.quantity, 0);
        const paidToTrip = pays
          .filter((p) => p.status === "succeeded" && (p.type === "deposit" || p.type === "balance"))
          .reduce((s, p) => s + p.amount, 0);

        await adapter.upsertContact({
          externalId: b.user_id,
          email: user?.email ?? "",
          firstName: user?.first_name ?? null,
          lastName: user?.last_name ?? null,
          // phone is encrypted at rest - decrypt before handing to the CRM.
          phone: decryptPII(user?.phone) ?? null,
          universitySociety: user?.university_society ?? null,
        });
        await adapter.upsertBooking({
          reference: b.reference,
          contactExternalId: b.user_id,
          tripName: trip?.name ?? "",
          status: b.status,
          tripCostPence: tripCost,
          paidToTripPence: paidToTrip,
          balancePence: tripCost - paidToTrip,
          startDate: trip?.start_date ?? "",
          endDate: trip?.end_date ?? "",
        });
      }

      await admin.from("crm_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: ev.attempts + 1 }).eq("id", ev.id);
      sent++;
    } catch (e) {
      await admin
        .from("crm_outbox")
        .update({ status: "failed", attempts: ev.attempts + 1, last_error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
        .eq("id", ev.id);
      failed++;
    }
  }

  return { total: events?.length ?? 0, sent, failed };
}
