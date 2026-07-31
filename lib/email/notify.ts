import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueAndSend } from "./outbox";
import type { EmailPayload, EmailTemplate } from "./types";

/**
 * Turns a domain event into the right message. Kept out of the webhook handler
 * so the handler stays about money and this stays about words.
 *
 * Every function here is best-effort and never throws: the caller has already
 * recorded a payment, and a mail failure must not 5xx a Stripe delivery into a
 * retry. Failures are logged and the row (if enqueued) is retried by the cron.
 */

interface Context {
  email: string;
  payload: EmailPayload;
  status: string;
}

/** Loads everything the templates need in one round trip. */
async function loadContext(bookingId: string): Promise<Context | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(
      "reference, status, users(first_name, email), trips(name, start_date, end_date, balance_due_date, damage_deposit_amount)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !data) {
    console.error(`[email] could not load booking ${bookingId}:`, error?.message ?? "not found");
    return null;
  }

  const user = data.users as { first_name: string | null; email: string | null } | null;
  const trip = data.trips as {
    name: string;
    start_date: string | null;
    end_date: string | null;
    balance_due_date: string | null;
    damage_deposit_amount: number | null;
  } | null;
  if (!user?.email) {
    console.error(`[email] booking ${bookingId} has no recipient address`);
    return null;
  }

  // Balance is recomputed server-side from DB rows, never passed in by a caller.
  const { data: balance } = await admin.rpc("booking_balance", { p_booking_id: bookingId });

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return {
    email: user.email,
    status: data.status,
    payload: {
      firstName: user.first_name ?? undefined,
      reference: data.reference,
      tripName: trip?.name,
      balance: typeof balance === "number" ? balance : undefined,
      damageDeposit: trip?.damage_deposit_amount ?? undefined,
      balanceDueDate: trip?.balance_due_date
        ? new Date(trip.balance_due_date).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : undefined,
      ticketsUrl: site ? `${site}/dashboard` : undefined,
    },
  };
}

/**
 * A payment landed. `eventId` is the Stripe event id and becomes the dedupe key,
 * so the three-day retry window cannot produce three receipts.
 */
export async function notifyPaymentSucceeded(
  bookingId: string,
  kind: string,
  amountPence: number,
  eventId: string,
): Promise<void> {
  try {
    const ctx = await loadContext(bookingId);
    if (!ctx) return;

    // Status decides the message, not the payment kind: paying into a trip that
    // filled up mid-checkout is a refund email, not a receipt.
    const template: EmailTemplate =
      ctx.status === "waitlisted"
        ? "waitlisted"
        : kind === "deposit"
          ? "booking_confirmed"
          : "payment_receipt";

    await enqueueAndSend({
      dedupeKey: `payment:${eventId}`,
      to: ctx.email,
      template,
      payload: { ...ctx.payload, amountPaid: amountPence, kind: kind as EmailPayload["kind"] },
    });
  } catch (e) {
    console.error(`[email] notifyPaymentSucceeded(${bookingId}) failed:`, e instanceof Error ? e.message : e);
  }
}

/** A waitlisted student has been given a place. */
export async function notifyWaitlistPromoted(bookingId: string): Promise<void> {
  try {
    const ctx = await loadContext(bookingId);
    if (!ctx) return;
    await enqueueAndSend({
      // Keyed on the booking, not an event: promotion happens once, and a repeat
      // admin click must not re-email.
      dedupeKey: `promoted:${bookingId}`,
      to: ctx.email,
      template: "waitlist_promoted",
      payload: ctx.payload,
    });
  } catch (e) {
    console.error(`[email] notifyWaitlistPromoted(${bookingId}) failed:`, e instanceof Error ? e.message : e);
  }
}

/** The damage deposit has been returned after the trip. */
export async function notifyDamageDepositRefunded(
  bookingId: string,
  refundedPence: number,
  withheldPence: number,
): Promise<void> {
  try {
    const ctx = await loadContext(bookingId);
    if (!ctx) return;
    await enqueueAndSend({
      dedupeKey: `damage-refund:${bookingId}`,
      to: ctx.email,
      template: "damage_deposit_refunded",
      payload: { ...ctx.payload, amountPaid: refundedPence, withheld: withheldPence },
    });
  } catch (e) {
    console.error(`[email] notifyDamageDepositRefunded(${bookingId}) failed:`, e instanceof Error ? e.message : e);
  }
}
