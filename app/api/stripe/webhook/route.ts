import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe SDK + raw-body verification require the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ONLY writer of payments / damage_deposits. Verifies the Stripe signature,
 * dedupes on event.id, and drives the atomic capacity+ledger finalize. Client
 * callbacks never write money.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return new NextResponse("Missing signature or secret", { status: 400 });
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
      return new NextResponse("Could not record event", { status: 500 });
    }
    const { data: prior } = await admin
      .from("stripe_events")
      .select("processed_at")
      .eq("id", event.id)
      .maybeSingle();
    if (prior?.processed_at) {
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
        }
        break;
      }
      case "payment_intent.payment_failed": {
        // No capacity change; the hold stays until it expires. Nothing to write.
        break;
      }
      // charge.refunded / charge.dispute.created handled in the admin/refund slice.
      default:
        break;
    }

    await admin
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);

    return NextResponse.json({ received: true });
  } catch (e) {
    // Return 5xx so Stripe retries; the event row stays unprocessed for replay.
    const message = e instanceof Error ? e.message : "handler error";
    return new NextResponse(message, { status: 500 });
  }
}
