import Link from "next/link";
import { Stepper } from "@/components/ui/Stepper";

export const FLOW_STEPS = ["Trip", "Extras", "Your details", "Payment"];

/** Booking-flow bar: a Back link + the numbered stepper. */
export function FlowBar({
  step,
  backHref,
  backLabel,
}: {
  step: number;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-6 py-3">
        <Link
          href={backHref}
          className="whitespace-nowrap text-[13px] font-medium text-soft transition-colors hover:text-ink"
        >
          ← {backLabel}
        </Link>
        <Stepper steps={FLOW_STEPS} current={step} />
      </div>
    </div>
  );
}
