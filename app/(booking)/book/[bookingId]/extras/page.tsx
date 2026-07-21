import { notFound, redirect } from "next/navigation";
import { getBookingContext } from "@/lib/db/queries";
import { computePricing } from "@/lib/pricing/compute";
import { ExtrasFlow, type UiExtra } from "@/components/booking/ExtrasFlow";
import { FlowBar } from "@/components/chrome/FlowBar";
import { formatDateRange } from "@/lib/utils/dates";
import type { ExtraWithTiers } from "@/lib/db/queries";

const toUi = (e: ExtraWithTiers): UiExtra => ({
  id: e.id,
  name: e.name,
  description: e.description,
  price: e.price,
  priceTbc: e.price_tbc,
  hasTiers: e.has_quality_tiers,
  tiers: e.extra_tiers.map((t) => ({ id: t.id, name: t.name, price: t.price })),
});

export default async function ExtrasPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const ctx = await getBookingContext(bookingId);
  if (!ctx) notFound();
  if (ctx.booking.status !== "pending") redirect("/");

  const coach = ctx.extras.find((e) => e.type === "transport") ?? null;
  const equipment = ctx.extras.filter((e) => e.type === "equipment");
  const lessons = ctx.extras.find((e) => e.type === "lessons") ?? null;
  const events = ctx.extras.filter((e) => e.type === "event");

  const selectedIds = ctx.selected.map((s) => s.extra_id);
  const tiers: Record<string, string> = {};
  ctx.selected.forEach((s) => {
    if (s.extra_tier_id) tiers[s.extra_id] = s.extra_tier_id;
  });

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
      <FlowBar step={1} backHref="/trip" backLabel="Back to trip search" />
      <ExtrasFlow
        bookingId={bookingId}
        tripName={ctx.trip.name}
        tripMeta={`${ctx.trip.resort} · ${formatDateRange(ctx.trip.start_date, ctx.trip.end_date)} · 1 place`}
        coach={coach ? toUi(coach) : null}
        equipment={equipment.map(toUi)}
        lessons={lessons ? toUi(lessons) : null}
        events={events.map(toUi)}
        initialSelectedIds={selectedIds}
        initialTiers={tiers}
        initialPricing={pricing}
      />
    </>
  );
}
