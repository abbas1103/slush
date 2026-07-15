import { notFound, redirect } from "next/navigation";
import { getBookingContext } from "@/lib/db/queries";
import { computePricing } from "@/lib/pricing/compute";
import { FlowBar } from "@/components/chrome/FlowBar";
import { SummarySidebar } from "@/components/booking/SummarySidebar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { formatDate, formatDateRange } from "@/lib/utils/dates";

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const ctx = await getBookingContext(bookingId);
  if (!ctx) notFound();
  if (ctx.booking.status !== "pending") redirect("/");

  const lineItems = ctx.selected.map((s) => {
    const ex = ctx.extras.find((e) => e.id === s.extra_id);
    const tier = ex?.extra_tiers.find((t) => t.id === s.extra_tier_id);
    return {
      label: `${ex?.name ?? "Extra"}${tier ? ` — ${tier.name}` : ""}`,
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
      <div className="mx-auto grid max-w-[1120px] gap-8 px-6 py-8 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <div>
            <h1>Pay your deposit</h1>
            <p className="mt-2 text-[15px] text-soft">
              Secure your place with a <Money pence={pricing.depositToday} stripZeros /> deposit —{" "}
              <Money pence={pricing.damageDeposit} stripZeros /> of it a refundable damage deposit.
              Pay the rest any time before {formatDate(ctx.trip.balance_due_date)}.
            </p>
          </div>

          <Card>
            <h3 className="mb-3">How much to pay today</h3>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between rounded-btn border border-ink p-3.5 shadow-[inset_0_0_0_1px_var(--color-ink)]">
                <div>
                  <div className="text-[14px] font-semibold">Pay deposit now</div>
                  <div className="text-[13px] text-soft">
                    <Money pence={pricing.downpayment} stripZeros /> downpayment +{" "}
                    <Money pence={pricing.damageDeposit} stripZeros /> refundable damage deposit
                  </div>
                </div>
                <div className="text-right text-[14px] font-semibold">
                  <Money pence={pricing.depositToday} /> <span className="block text-[12px] font-normal text-soft">today</span>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-btn border border-line p-3.5">
                <div>
                  <div className="text-[14px] font-semibold">Pay in full</div>
                  <div className="text-[13px] text-soft">Whole trip + refundable damage deposit</div>
                </div>
                <div className="text-right text-[14px] font-semibold">
                  <Money pence={pricing.payInFullToday} /> <span className="block text-[12px] font-normal text-soft">today</span>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="rounded-btn bg-soft-panel p-3 text-[13px] text-ink-2">
              ⚠ Your <Money pence={pricing.depositToday} stripZeros /> deposit is{" "}
              <Money pence={pricing.downpayment} stripZeros /> downpayment plus a{" "}
              <Money pence={pricing.damageDeposit} stripZeros /> refundable damage deposit. The damage
              deposit is returned to your card after the trip. Your balance is due by{" "}
              {formatDate(ctx.trip.balance_due_date)}.
            </div>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <SummarySidebar
            pricing={pricing}
            tripName={ctx.trip.name}
            tripMeta={`${ctx.trip.resort} · ${formatDateRange(ctx.trip.start_date, ctx.trip.end_date)} · 1 place`}
          >
            <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[14px]">
              <div className="flex justify-between">
                <span className="text-soft">Downpayment today</span>
                <Money pence={pricing.downpayment} className="font-semibold" />
              </div>
              <div className="flex justify-between">
                <span className="text-soft">Refundable damage deposit</span>
                <Money pence={pricing.damageDeposit} className="font-semibold" />
              </div>
              <div className="flex justify-between">
                <span className="text-soft">Balance after deposit</span>
                <Money pence={pricing.balanceAfterDeposit} className="font-semibold" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-btn bg-panel px-3 py-2.5 text-white">
              <span className="text-[13px]">Due today</span>
              <Money pence={pricing.depositToday} className="font-bold" />
            </div>
            <Button className="mt-3 w-full" disabled>
              🔒 Pay <Money pence={pricing.depositToday} stripZeros /> deposit
            </Button>
            <p className="mt-2 text-center text-[12px] text-soft">
              Stripe checkout is wired in the next slice.
            </p>
          </SummarySidebar>
        </aside>
      </div>
    </>
  );
}
