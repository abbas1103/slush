"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "included", label: "What's included" },
  { id: "lineup", label: "Line-up" },
  { id: "stay", label: "Accommodation" },
  { id: "location", label: "Location" },
];

/** Trip-detail tab bar. Like the prototype, tabs scroll to sections rather than
 *  swapping content (all sections are rendered). */
export function TripTabs() {
  const [active, setActive] = useState("overview");

  function go(id: string) {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => go(t.id)}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] font-semibold transition-colors",
            active === t.id
              ? "border-ink text-ink"
              : "border-transparent text-soft hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
