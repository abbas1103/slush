import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { CANCELABLE_PI } from "@/lib/stripe/cancelable";

/**
 * Resolve bookings abandoned at the payment step.
 *
 * THE GAP THIS CLOSES: three correct rules combined into a booking that could
 * never resolve. `expire_stale_holds` skips anything with a payment_intent_id
 * ("never cancel what might still settle"), `release_hold` refuses with
 * payment_in_flight for the same reason, and the only two places that cancel an
 * intent both require the student to come back and act. A student who reaches
 * the payment page and never returns therefore left a `pending` row for ever.
 * Capacity was always safe - the hold still expired - but the row never cleared,
 * so the bookings list would accumulate rows an organiser cannot distinguish
 * from someone about to pay.
 *
 * The fix is to remove the thing that blocks the existing sweep: cancel the dead
 * intent and clear the column. `expire_stale_holds` then cancels the booking on
 * its next pass, which keeps ONE owner of the pending -> cancelled transition
 * rather than adding a second.
 *
 * SAFETY: only ever cancels intents in CANCELABLE_PI. Anything processing,
 * succeeded or requiring capture is left completely alone for the webhook.
 */

/** How long after the hold expires before an intent counts as abandoned. */
const GRACE_MINUTES = 60;
/** Bounded so one run cannot exceed the cron's wall clock. */
const MAX_PER_RUN = 100;

export interface AbandonedSweepResult {
  considered: number;
  /** Intent cancelled at Stripe and the column cleared. */
  cancelled: number;
  /** Intent was already dead; column cleared. */
  cleared: number;
  /** Money moving or settled - deliberately untouched. */
  skipped: number;
  failed: number;
}

interface Row {
  id: string;
  payment_intent_id: string | null;
  holds: { status: string; expires_at: string }[] | null;
  payments: { status: string }[] | null;
}

export async function sweepAbandonedIntents(): Promise<AbandonedSweepResult> {
  const admin = createAdminClient();
  const out: AbandonedSweepResult = { considered: 0, cancelled: 0, cleared: 0, skipped: 0, failed: 0 };

  const { data, error } = await admin
    .from("bookings")
    .select("id, payment_intent_id, holds(status, expires_at), payments(status)")
    .eq("status", "pending")
    .not("payment_intent_id", "is", null)
    .limit(MAX_PER_RUN);
  if (error) throw new Error(`Could not list abandoned bookings: ${error.message}`);

  const cutoff = Date.now() - GRACE_MINUTES * 60_000;

  for (const row of (data ?? []) as unknown as Row[]) {
    const intentId = row.payment_intent_id;
    if (!intentId) continue;

    // A succeeded payment means the webhook got there first; never touch it.
    if ((row.payments ?? []).some((p) => p.status === "succeeded")) continue;

    // Still holding a place, or only recently lapsed: the student may be mid
    // checkout. The grace period is what stops this racing a live attempt.
    const holds = row.holds ?? [];
    const stillHeld = holds.some((h) => h.status === "active" && Date.parse(h.expires_at) > Date.now());
    if (stillHeld) continue;
    const newestExpiry = holds.length ? Math.max(...holds.map((h) => Date.parse(h.expires_at))) : 0;
    if (newestExpiry > cutoff) continue;

    out.considered++;
    try {
      const intent = await stripe.paymentIntents.retrieve(intentId);

      if (CANCELABLE_PI.has(intent.status)) {
        await stripe.paymentIntents.cancel(intentId);
        if (await clearIntent(admin, row.id, intentId)) out.cancelled++;
        else out.failed++;
      } else if (intent.status === "canceled") {
        if (await clearIntent(admin, row.id, intentId)) out.cleared++;
        else out.failed++;
      } else {
        // processing / succeeded / requires_capture - the webhook owns these.
        out.skipped++;
      }
    } catch (e) {
      out.failed++;
      console.error(`[abandoned] ${row.id} (${intentId}):`, e instanceof Error ? e.message : e);
    }
  }

  return out;
}

/**
 * Clear the column, but ONLY if it still points at the intent we just killed.
 * A student returning mid-sweep gets a fresh intent written to this row, and
 * blanking that would strand a live, chargeable intent with no booking pointing
 * at it - invisible to the double-charge guard.
 */
async function clearIntent(
  admin: ReturnType<typeof createAdminClient>,
  bookingId: string,
  intentId: string,
): Promise<boolean> {
  const { error } = await admin
    .from("bookings")
    .update({ payment_intent_id: null })
    .eq("id", bookingId)
    .eq("payment_intent_id", intentId);
  if (error) {
    console.error(`[abandoned] could not clear ${bookingId}:`, error.message);
    return false;
  }
  return true;
}
