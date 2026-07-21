import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TimelineItem {
  title: React.ReactNode;
  desc: React.ReactNode;
  /** The current step is filled ink; others are muted. */
  now?: boolean;
}

/** `.timeline` - the "what happens next" list on the confirmation screen. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span
            aria-hidden
            className={cn(
              "mt-1 size-2.5 shrink-0 rounded-full",
              item.now ? "bg-ink" : "bg-track",
            )}
          />
          <div>
            <div className="text-[13px] font-semibold text-ink">{item.title}</div>
            <div className="text-[13px] text-soft">{item.desc}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
