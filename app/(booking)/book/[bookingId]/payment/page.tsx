import { notFound, redirect } from "next/navigation";
import { getBookingContext } from "@/lib/db/queries";
import { computePricing } from "@/lib/pricing/compute";
import { FlowBar } from "@/components/chrome/FlowBar";
import { PaymentPanel } from "@/components/booking/PaymentPanel";
import { formatDate, formatDateRange } from "@/lib/utils/dates";

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const ctx = await getBookingContext(bookingId);
  if (!ctx) notFound();
  if (ctx.booking.status !== "pending") redirect(`/book/${bookingId}/confirmation`);

  const lineItems = ctx.selected.map((s) => {
    const ex = ctx.extras.find((e) => e.id === s.extra_id);
    const tier = ex?.extra_tiers.find((t) => t.id === s.extra_tier_id);
    return {
      label: `${ex?.name ?? "Extra"}${tier ? ` - ${tier.name}` : ""}`,
      amount: s.price_at_booking * s.quantity,
    };
  });
  const pricing = computePricing({
    basePrice: ctx.trip.base_price,
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
      />
    </>
  );
}
