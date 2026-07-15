import { Card } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import type { Pricing } from "@/lib/pricing/compute";

/** Sticky booking summary: line items + total, reused across the flow. */
export function SummarySidebar({
  pricing,
  tripName,
  tripMeta,
  children,
}: {
  pricing: Pricing;
  tripName?: string;
  tripMeta?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      {tripName && (
        <div className="border-b border-line pb-3">
          <div className="text-[14px] font-bold">{tripName}</div>
          {tripMeta && <div className="text-[12px] text-soft">{tripMeta}</div>}
        </div>
      )}
      <div className="flex flex-col gap-2 py-3 text-[14px]">
        {pricing.lineItems.map((li, i) => (
          <div key={i} className="flex justify-between gap-4">
            <span className="text-ink-2">{li.label}</span>
            <Money pence={li.amount} className="shrink-0 font-semibold" />
          </div>
        ))}
      </div>
      <div className="flex justify-between border-t border-line pt-3 text-[15px] font-bold">
        <span>Total</span>
        <Money pence={pricing.tripCost} />
      </div>
      {children}
    </Card>
  );
}
