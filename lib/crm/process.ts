import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPII } from "@/lib/crypto/pii";
import { getCrmAdapter } from "./adapters";

/** Attempts after which the drain gives up on a row (matches the select filter). */
const MAX_ATTEMPTS = 5;
/**
 * Rows fetched per run. Each row costs several round trips (booking read, trip
 * read, then the CRM call), so the OLD comment claiming 500 "clears a launch" was
 * false: the budget below stopped the loop long before the limit was reached, and
 * the real throughput was a handful of events per run. Sized to what the budget
 * can actually get through, so `queued` in the result is an honest backlog rather
 * than an artefact of a limit nobody reaches.
 */
const DEFAULT_LIMIT = 200;
/**
 * Wall-clock budget for one run, set against the route's declared
 * `maxDuration = 60`. Stop short of it and leave the remainder queued rather than
 * be killed mid-loop. Keep the two in step.
 */
const DEFAULT_BUDGET_MS = 50_000;

/**
 * Outcome of one drain run. `queued` is the backlog matching the drain filter
 * when the run started - the number to watch, since a growing backlog is the
 * only symptom of a CRM that is not accepting events.
 */
export type CrmDrainResult = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  queued: number;
  note?: string;
};

/**
 * Drain the CRM outbox: for each pending/failed event, build the contact +
 * booking payload and push via the configured adapter, marking sent/failed.
 * Idempotent at the CRM (upsert by external id / reference). Run on a schedule.
 *
 * Every DB error is either recorded on the row or thrown, so a run that could
 * not do its job never reports success back to the cron.
 */
export async function processCrmOutbox(
  limit = DEFAULT_LIMIT,
  budgetMs = DEFAULT_BUDGET_MS,
): Promise<CrmDrainResult> {
  const startedAt = Date.now();
  const admin = createAdminClient();
  const adapter = getCrmAdapter();

  const { count, error: countError } = await admin
    .from("crm_outbox")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS);
  if (countError) {
    // Throwing makes the cron route 5xx, so Vercel logs a failed run and Sentry
    // sees it. Returning zeroes here is what made a broken drain look green.
    throw new Error(`crm_outbox count failed: ${countError.message}`);
  }
  const queued = count ?? 0;

  if (!adapter.delivers) {
    // No CRM configured yet: do nothing at all and leave every row queued, so
    // the whole history replays the moment a real adapter is set up. Marking
    // them 'sent' would consume the queue with nothing to replay from.
    console.warn(`[crm] adapter '${adapter.name}' delivers nothing - leaving ${queued} event(s) queued`);
    return { total: 0, sent: 0, failed: 0, skipped: queued, queued, note: "no CRM provider configured" };
  }

  // Fewest attempts first, then oldest: a row that keeps failing sinks behind
  // the fresh events instead of occupying the head of every batch.
  const { data: events, error: selectError } = await admin
    .from("crm_outbox")
    .select("*")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("attempts", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (selectError) {
    throw new Error(`crm_outbox select failed: ${selectError.message}`);
  }

  const rows = events ?? [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const ev of rows) {
    if (Date.now() - startedAt > budgetMs) {
      skipped = rows.length - sent - failed;
      console.warn(`[crm] time budget reached after ${sent + failed} event(s) - ${skipped} left queued`);
      break;
    }

    const attempts = ev.attempts + 1;
    try {
      const { data: b, error: bookingError } = await admin
        .from("bookings")
        .select("id, reference, status, trip_id, user_id, base_price_at_booking, users(email, first_name, last_name, phone, university_society), booking_extras(price_at_booking, quantity), payments(type, amount, status)")
        .eq("id", ev.entity_id)
        .maybeSingle();
      // A booking we cannot read is a FAILURE, not a delivery: marking the row
      // 'sent' would drop that student from the CRM forever.
      if (bookingError) throw new Error(`booking read failed: ${bookingError.message}`);
      if (!b) throw new Error(`booking ${ev.entity_id} not found`);

      const { data: trip, error: tripError } = await admin
        .from("trips")
        .select("name, base_price, downpayment_amount, start_date, end_date")
        .eq("id", b.trip_id)
        .single();
      if (tripError) throw new Error(`trip read failed: ${tripError.message}`);
      const user = b.users as { email: string; first_name: string | null; last_name: string | null; phone: string | null; university_society: string | null } | null;
      const bes = (b.booking_extras as { price_at_booking: number; quantity: number }[]) ?? [];
      const pays = (b.payments as { type: string; amount: number; status: string }[]) ?? [];
      // Snapshot first, live trip price only as a fallback - otherwise an admin
      // price edit would push a rewritten balance for every existing booking.
      const tripCost =
        (b.base_price_at_booking ?? trip?.base_price ?? 0) +
        bes.reduce((s, e) => s + e.price_at_booking * e.quantity, 0);
      // Must match booking_trip_paid and computePaidToTrip: 000300 enqueues a
      // CRM sync on waitlist_refund, and without the refund term that sync
      // pushed the pre-refund balance, so the CRM's figure was wrong precisely
      // when the trigger fired.
      const received = pays
        .filter((p) => p.status === "succeeded" && (p.type === "deposit" || p.type === "balance"))
        .reduce((s, p) => s + p.amount, 0);
      const returned = pays
        .filter((p) => p.status === "succeeded" && p.type === "waitlist_refund")
        .reduce((s, p) => s + Math.min(p.amount, trip?.downpayment_amount ?? 0), 0);
      const paidToTrip = received - returned;

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

      const { error: markSentError } = await admin
        .from("crm_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts })
        .eq("id", ev.id);
      // Delivered but not recorded: count it as failed so the run is not
      // reported clean. The row is retried next time; the adapter upserts, so a
      // repeat delivery is harmless.
      if (markSentError) throw new Error(`marking sent failed: ${markSentError.message}`);
      sent++;
    } catch (e) {
      failed++;
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      const { error: markFailedError } = await admin
        .from("crm_outbox")
        .update({ status: "failed", attempts, last_error: message })
        .eq("id", ev.id);
      if (markFailedError) {
        console.error(`[crm] event ${ev.id} failed and could not be marked failed: ${markFailedError.message}`);
      }
      if (attempts >= MAX_ATTEMPTS) {
        // Dead letter: the drain filter will never select this row again, so say
        // so loudly rather than dropping it in silence.
        console.error(`[crm] event ${ev.id} (${ev.event_type} ${ev.entity_id}) exhausted ${MAX_ATTEMPTS} attempts, giving up: ${message}`);
      } else {
        console.warn(`[crm] event ${ev.id} attempt ${attempts}/${MAX_ATTEMPTS} failed: ${message}`);
      }
    }
  }

  // Nothing got through at all (wrong API key, CRM down): fail the run so the
  // cron shows red instead of a green tick over a queue that never drains.
  if (sent === 0 && failed > 0) {
    throw new Error(`crm drain: all ${failed} attempted event(s) failed (${queued} queued)`);
  }

  return { total: rows.length, sent, failed, skipped, queued };
}
