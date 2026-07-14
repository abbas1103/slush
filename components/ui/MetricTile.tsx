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
      <div className="mt-1 text-[24px] font-extrabold tabular-nums">{value}</div>
      {sub && (
        <div className={cn("text-[11.5px]", dark ? "text-white/60" : "text-soft")}>
          {sub}
        </div>
      )}
    </div>
  );
}
