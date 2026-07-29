import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface MetricTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** The "remaining balance" tile is rendered dark in the prototype. */
  dark?: boolean;
  className?: string;
}

/** Dashboard metric tile (`.metrics` cell). */
export function MetricTile({ label, value, sub, dark, className }: MetricTileProps) {
  return (
    <div
      className={cn(
        "rounded-card border p-4",
        dark ? "border-transparent bg-panel text-white" : "border-line bg-surface",
        className,
      )}
    >
      <div className={cn("text-[12.5px]", dark ? "text-white/70" : "text-soft")}>
        {label}
      </div>
      {/* Below sm the tiles are two to a row, where a formatted date ("15 Nov
          2026") does not fit on one line at 24px - the prototype dropped that
          tile to 20px. Scaling the whole row keeps it consistent. */}
      <div className="mt-1 text-[clamp(16px,5vw,20px)] font-extrabold tabular-nums sm:text-[24px]">
        {value}
      </div>
      {sub && (
        <div className={cn("text-[11.5px]", dark ? "text-white/60" : "text-soft")}>
          {sub}
        </div>
      )}
    </div>
  );
}
