import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getBookingContext } from "@/lib/db/queries";
import { computePricing } from "@/lib/pricing/compute";
import { createPaymentIntent } from "@/app/(booking)/book/actions";
import { createClient } from "@/lib/supabase/server";
import { FlowBar } from "@/components/chrome/FlowBar";
import { PaymentPanel } from "@/components/booking/PaymentPanel";
import { formatDate, formatDateRange } from "@/lib/utils/dates";

export const metadata: Metadata = {
  title: "Payment - SLUSH",
  // Signed-in surface: never index it, and don't follow links out of it.
  robots: { index: false, follow: false },
};

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = await createClient();
  // The consents probe only needs the booking id, so it runs alongside the
  // context read rather than after it. RLS limits it to the caller's own rows.
  //
  // The deposit intent is minted HERE, in the render, rather than in an effect
  // after hydration. It used to cost the student three serial legs before a card
  // field existed: hydrate, then a createPaymentIntent round trip, then Stripe's
  // iframe. Now it rides along with the reads above, so it costs max(reads,
  // Stripe) instead of reads-then-Stripe, and the panel mounts with a client
  // secret already in hand.
  //
  // Deposit, not `mode`, because that is always the opening state: chosenMode
  // starts at "deposit" and a waiting-list booking is pinned to it (audit #17).
  // Switching to pay-in-full still goes through the action from the client.
  //
  // Safe to run before the guards below because createPaymentIntent repeats every
  // one of them itself - ownership, pending status, and the consents/insurance
  // gate (audit #39) - and returns an error instead of minting anything when they
  // fail. It is a directly callable server action, so it could never have trusted
  // this page's checks anyway.
  //
  // PREFETCH NOTE: this render must not run speculatively, or a hover would mint
  // a Stripe intent. It does not, because `loading.tsx` in this segment terminates
  // an App Router prefetch before the page body executes (measured: a request with
  // Next-Router-Prefetch:1 returns the boundary and never invokes this function).
  // That file is therefore load-bearing for more than perceived speed - do not
  // delete it without moving this call back into the client.
  const [ctx, consent, hold, initialIntent] = await Promise.all([
    getBookingContext(bookingId),
    supabase
      .from("consents")
      .select("id")
      .eq("booking_id", bookingId)
      .limit(1)
      .maybeSingle(),
    // The student was told at hold time whether they were taking a place or a
    // waiting-list spot; the payment screen has to say the same thing, or a
    // waitlister is offered "pay in full" for a place they do not have.
    supabase
      .from("holds")
      .select("is_waitlist")
      .eq("booking_id", bookingId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    createPaymentIntent(bookingId, "deposit"),
  ]);
  if (!ctx) notFound();
  if (ctx.booking.status !== "pending") redirect(`/book/${bookingId}/confirmation`);

  // Never take money before the details step has run. saveDetails is the sole
  // writer of the consents record, the passport/DOB PII, the insurance
  // declaration and the 18+ gate, so without both markers we would charge a
  // student who has accepted no terms and passed no age check (audit #39).
  // Fail closed on a read error too - error.tsx explains it and offers a retry.
  if (consent.error) throw new Error(consent.error.message);
  if (!consent.data || ctx.booking.insurance_choice === null) {
    redirect(`/book/${bookingId}/details`);
  }

  const lineItems = ctx.selected.map((s) => {
    const ex = ctx.extras.find((e) => e.id === s.extra_id);
    const tier = ex?.extra_tiers.find((t) => t.id === s.extra_tier_id);
    return {
      label: `${ex?.name ?? "Extra"}${tier ? ` - ${tier.name}` : ""}`,
      amount: s.price_at_booking * s.quantity,
    };
  });
  // Must mirror the server's authority exactly: createPaymentIntent prices from
  // bookings.base_price_at_booking (and so does the DB's compute_trip_cost). If
  // this page kept reading the LIVE trips.base_price, an admin editing the trip
  // price would make the "Pay £X" button state a figure Stripe never charges.
  const pricing = computePricing({
    basePrice: ctx.booking.base_price_at_booking ?? ctx.trip.base_price,
    depositAmount: ctx.trip.deposit_amount,
    downpaymentAmount: ctx.trip.downpayment_amount,
    damageDepositAmount: ctx.trip.damage_deposit_amount,
    extras: lineItems,
  });

  return (
    <>
      <FlowBar step={3} backHref={`/book/${bookingId}/details`} backLabel="Back to your details" />
      <PaymentPanel
        bookingId={bookingId}
        pricing={pricing}
        balanceDueLabel={formatDate(ctx.trip.balance_due_date)}
        tripName={ctx.trip.name}
        tripMeta={`${ctx.trip.resort} · ${formatDateRange(ctx.trip.start_date, ctx.trip.end_date)} · 1 place`}
        isWaitlist={hold.data?.is_waitlist ?? false}
        initialDeposit={
          initialIntent.ok
            ? { clientSecret: initialIntent.clientSecret, error: null }
            : { clientSecret: null, error: initialIntent.error }
        }
      />
    </>
  );
}
