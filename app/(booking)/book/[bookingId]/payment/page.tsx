import { notFound, redirect } from "next/navigation";
import { getBookingContext } from "@/lib/db/queries";
import { computePricing } from "@/lib/pricing/compute";
import { createClient } from "@/lib/supabase/server";
import { FlowBar } from "@/components/chrome/FlowBar";
import { PaymentPanel } from "@/components/booking/PaymentPanel";
import { formatDate, formatDateRange } from "@/lib/utils/dates";

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = await createClient();
  // The consents probe only needs the booking id, so it runs alongside the
  // context read rather than after it. RLS limits it to the caller's own rows.
  const [ctx, consent, hold] = await Promise.all([
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
      />
    </>
  );
}
