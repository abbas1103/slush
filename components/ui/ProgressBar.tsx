import { cn } from "@/lib/utils/cn";

interface ProgressBarProps {
  /** Percentage 0–100. */
  value: number;
  className?: string;
  label?: string;
}

/** `.progress` track + `.fill` — payment progress on confirmation/dashboard. */
export function ProgressBar({ value, className, label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-track", className)}
    >
      <div
        className="h-full rounded-full bg-ink transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
