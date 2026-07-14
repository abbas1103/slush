import { cn } from "@/lib/utils/cn";

interface StepperProps {
  steps: string[];
  /** Zero-based index of the current step. */
  current: number;
  className?: string;
}

/**
 * Numbered horizontal stepper (Trip · Extras · Your details · Payment).
 * Past steps show a tick, the current step is filled ink, future steps are grey.
 * Text labels hide below the `lg` (820px) breakpoint, leaving just the circles.
 */
export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn("flex items-center gap-2", className)}>
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "active" : "future";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold",
                state === "future" ? "bg-track text-soft" : "bg-ink text-white",
              )}
            >
              {state === "done" ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span
              className={cn(
                "hidden text-[13px] font-semibold lg:inline",
                state === "future" ? "text-soft" : "text-ink",
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden className="h-px w-3 bg-line lg:w-6" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
