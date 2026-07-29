import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/server";
import { stripeWebhookSecret } from "@/lib/stripe/webhook-secret";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe SDK + raw-body verification require the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Reportable detail: Stripe ids, pence, our own row ids. NEVER PII. */
type Facts = Record<string, string | number | boolean | null>;

/**
 * Put a money problem where an on-call human will see it: Sentry (env-gated, so
 * inert without a DSN) plus the Vercel runtime log. Facts are ids and amounts
 * only - never a name, email or the event payload (see sentry.server.config.ts).
 */
function alertOps(summary: string, event: Stripe.Event, facts: Facts) {
  console.error(`[stripe-webhook] ${event.type} ${event.id}: ${summary}`, facts);
  Sentry.captureMessage(summary, {
    level: "error",
    tags: { area: "stripe-webhook", event_type: event.type },
    extra: { event_id: event.id, ...facts },
  });
}

/** Same reach, for a thrown error - keeps the stack so a wedged webhook is diagnosable. */
function reportFailure(e: unknown, event: Stripe.Event) {
  const err = e instanceof Error ? e : new Error("Stripe webhook handler failed");
  console.error(`[stripe-webhook] ${event.type} ${event.id} failed: ${err.message}`);
  Sentry.captureException(err, {
    tags: { area: "stripe-webhook", event_type: event.type },
    extra: { event_id: event.id, ...failureFacts(event) },
  });
}

/** Which booking/charge a failed event was about. Narrowed per type, so no PII. */
function failureFacts(event: Stripe.Event): Facts {
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    return { intent_id: pi.id, amount: pi.amount, booking_id: pi.metadata?.booking_id ?? null };
  }
  if (event.type === "charge.refunded") {
    const charge = event.data.object;
    return { charge_id: charge.id, amount_refunded: charge.amount_refunded };
  }
  return {};
}

/** A Stripe expandable field (an id, or the expanded object) → the id. */
function refId(ref: string | { id: string } | null): string | null {
  if (ref === null) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/** The booking a Stripe intent belongs to, resolved from our own ledger rows. */
async function bookingIdForIntent(admin: AdminClient, intentId: string | null): Promise<string | null> {
  if (!intentId) return null;
  const { data, error } = await admin
    .from("payments")
    .select("booking_id")
    .eq("stripe_payment_intent_id", intentId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.booking_id ?? null;
}

/**
 * Record a money movement the `payments` ledger cannot currently hold:
 * payment_type has no member for an out-of-band refund or a chargeback, and
 * payments is UNIQUE on (intent, type) so a second refund row per intent has
 * nowhere to go. audit_log is the append-only trail admins read for every
 * refund, so these land there and are alerted on. Idempotent on the Stripe
 * event id, and metadata carries refs/amounts only (no PII).
 */
async function recordMoneyEvent(
  admin: AdminClient,
  event: Stripe.Event,
  bookingId: string | null,
  action: string,
  facts: Facts,
) {
  const { data: prior, error: priorErr } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .contains("metadata", { event_id: event.id })
    .limit(1)
    .maybeSingle();
  if (priorErr) throw new Error(priorErr.message);
  if (prior) return;
  // No actor: this is Stripe moving money, not a person in the CMS.
  const { error } = await admin.from("audit_log").insert({
    action,
    target_type: "booking",
    target_id: bookingId,
    metadata: { ...facts, event_id: event.id },
  });
  if (error) throw new Error(error.message);
}

/**
 * The ONLY writer of payments / damage_deposits. Verifies the Stripe signature,
 * dedupes on event.id, and drives the atomic capacity+ledger finalize. Client
 * callbacks never write money.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  // Resolved and validated at module load in lib/stripe/webhook-secret.ts, which
  // ONLY this route imports - so an unset signing secret fails the webhook (5xx,
  // which Stripe retries) without touching the booking flow or the CMS. Reading
  // process.env here would duplicate that check into a branch that cannot run,
  // and 400ing on a deploy fault makes Stripe give up rather than retry.
  const secret = stripeWebhookSecret;
  if (!sig) {
    // Just a stray caller with no Stripe signature: not a deploy fault.
    return new NextResponse("Missing signature", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch {
    return new NextResponse("Invalid signature", { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency: first sighting inserts the marker row. On a duplicate (23505)
  // we must NOT blindly ack - a prior delivery may have recorded the event but
  // then FAILED to finalize (returned 5xx). We only skip when processed_at is
  // set; otherwise we fall through and re-drive the handler (it is idempotent
  // via payments UNIQUE(intent,type) + the FOR UPDATE finalize lock). This is
  // what makes Stripe's automatic retry actually re-attempt a failed finalize
  // instead of it being silently swallowed as a "duplicate".
  const { error: insErr } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type, payload: JSON.parse(body) });
  if (insErr) {
    if (insErr.code !== "23505") {
      reportFailure(new Error(`stripe_events insert failed: ${insErr.message}`), event);
      return new NextResponse("Could not record event", { status: 500 });
    }
    const { data: prior, error: priorErr } = await admin
      .from("stripe_events")
      .select("processed_at")
      .eq("id", event.id)
      .maybeSingle();
    if (priorErr) {
      // We can't tell whether the earlier delivery finished. Re-driving is
      // idempotent, so fall through rather than ack an unprocessed event.
      reportFailure(new Error(`stripe_events lookup failed: ${priorErr.message}`), event);
    } else if (prior?.processed_at) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Recorded but not yet processed → fall through and re-drive.
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const bookingId = pi.metadata?.booking_id;
        const kind = pi.metadata?.payment_kind; // 'deposit' | 'full' | 'balance'
        if (bookingId && kind) {
          const { error } = await admin.rpc("record_payment_and_finalize", {
            p_booking_id: bookingId,
            p_intent_id: pi.id,
            p_charge_id: typeof pi.latest_charge === "string" ? pi.latest_charge : "",
            p_kind: kind,
            p_amount_total: pi.amount,
          });
          if (error) throw new Error(error.message);
        } else {
          // Charged with no booking metadata: nothing can be finalized, so the
          // student is out of pocket with no place. Must not ack silently.
          alertOps("Succeeded payment carries no booking metadata - not finalized.", event, {
            intent_id: pi.id,
            amount: pi.amount,
          });
        }
        break;
      }
      case "payment_intent.payment_failed": {
        // No capacity change; the hold stays until it expires. Nothing to write.
        break;
      }
      case "payment_intent.processing": {
        // A delayed method is still settling. Nothing has been captured, so
        // nothing is written - the ledger only ever records money that landed.
        // The 30-minute hold keeps the place until succeeded/failed arrives.
        break;
      }
      case "payment_intent.canceled": {
        // Nothing was captured, so there is nothing to write, and the place is
        // released by hold expiry. Deliberately NOT clearing the single-live-
        // intent guard (bookings.payment_intent_id): the checkout actions own
        // that column and clear it conditionally under their own read, so a
        // write from here would race them into a spurious "refresh and try
        // again". A cancelled intent is already handled on their next read.
        break;
      }
      // Refunds the ADMIN issues write their own ledger row inline (app/admin/
      // actions.ts). The cases below are for money that moves outside the app:
      // a Dashboard refund, or a chargeback - neither of which anything else in
      // the codebase ever hears about.
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const intentId = refId(charge.payment_intent);
        const bookingId = await bookingIdForIntent(admin, intentId);
        const facts: Facts = {
          charge_id: charge.id,
          intent_id: intentId,
          charge_amount: charge.amount,
          amount_refunded: charge.amount_refunded,
          fully_refunded: charge.refunded,
        };
        if (!intentId || !bookingId) {
          alertOps("Refunded charge does not map to a booking - reconcile by hand.", event, facts);
          break;
        }

        // What the ledger already knows came back on this intent. An in-app
        // refund reconciles to zero here; a Dashboard one shows up as a gap.
        const { data: refunds, error: refundsErr } = await admin
          .from("payments")
          .select("amount")
          .eq("stripe_payment_intent_id", intentId)
          .eq("status", "succeeded")
          .in("type", ["damage_deposit_refund", "waitlist_refund"]);
        if (refundsErr) throw new Error(refundsErr.message);
        const recorded = (refunds ?? []).reduce((sum, r) => sum + r.amount, 0);
        const unrecorded = charge.amount_refunded - recorded;
        if (unrecorded > 0) {
          const gap: Facts = { ...facts, ledger_refunded: recorded, unrecorded };
          await recordMoneyEvent(admin, event, bookingId, "stripe_refund_unrecorded", gap);
          alertOps("Stripe refunded money the ledger never recorded - the place is still held.", event, gap);
        }

        // A FULL refund is unambiguous: every penny of that charge is back with
        // the student, so nothing tied to it may still read as money we hold.
        // Both updates are guarded on current state, so a retry is a no-op.
        if (charge.refunded && charge.amount_refunded >= charge.amount) {
          const { error: ddErr } = await admin
            .from("damage_deposits")
            .update({
              status: "refunded",
              refunded_at: new Date().toISOString(),
              // a still-held row never carries a refund id, so this loses nothing
              stripe_refund_id: charge.refunds?.data[0]?.id ?? null,
            })
            .eq("booking_id", bookingId)
            // Scope to the intent the deposit was actually captured on. Without
            // this, a full out-of-band refund of a BALANCE charge would close the
            // deposit's state machine while SLUSH still holds the money: the admin
            // "Refund damage" button disappears (it renders on damageStatus ===
            // 'held'), refundDamage answers "No held damage deposit", and the
            // student is told their £100 came back when it never left.
            .eq("stripe_payment_intent_id", intentId)
            .eq("status", "held");
          if (ddErr) throw new Error(ddErr.message);

          // paidToTrip counts only 'succeeded' rows, so this is what stops the
          // books claiming money Stripe has given back.
          const { error: ledgerErr } = await admin
            .from("payments")
            .update({ status: "refunded" })
            .eq("stripe_payment_intent_id", intentId)
            .eq("status", "succeeded")
            .in("type", ["deposit", "balance", "damage_deposit_hold"]);
          if (ledgerErr) throw new Error(ledgerErr.message);
        }
        break;
      }
      case "charge.dispute.created":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        const intentId = refId(dispute.payment_intent);
        const bookingId = await bookingIdForIntent(admin, intentId);
        const facts: Facts = {
          dispute_id: dispute.id,
          charge_id: refId(dispute.charge),
          intent_id: intentId,
          amount: dispute.amount,
          reason: dispute.reason,
          dispute_status: dispute.status,
        };
        await recordMoneyEvent(admin, event, bookingId, `stripe_${event.type.replace(/\./g, "_")}`, facts);
        // 'won'/'prevented' mean the funds were never taken or have come back.
        // Anything else means the money has left (or is about to) while the
        // place is still counted, so a human has to decide whether it stands.
        if (dispute.status !== "won" && dispute.status !== "prevented") {
          alertOps("Chargeback against a booking - money at risk, the place is still held.", event, facts);
        }
        break;
      }
      default:
        break;
    }

    const { error: doneErr } = await admin
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
    if (doneErr) {
      // Losing the marker would let a retry re-drive work we already did, so
      // treat it as a failure and let Stripe retry the whole (idempotent) event.
      throw new Error(`stripe_events processed_at update failed: ${doneErr.message}`);
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    // Return 5xx so Stripe retries; the event row stays unprocessed for replay.
    // Report first: a 500 body is otherwise only visible in Stripe's own
    // webhook-failure list, which nobody is watching at 2am.
    reportFailure(e, event);
    const message = e instanceof Error ? e.message : "handler error";
    return new NextResponse(message, { status: 500 });
  }
}
