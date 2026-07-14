import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface OptionRowProps {
  title: React.ReactNode;
  desc?: React.ReactNode;
  price?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** Visual affordance: a round radio dot or a square checkbox. */
  control?: "radio" | "checkbox";
  onClick?: () => void;
  className?: string;
}

/**
 * `.opt` selection row — used for equipment single-select, insurance, pay-mode
 * and payment-method choices. Selected = ink border + inset ring. The whole row
 * is the click target.
 */
export function OptionRow({
  title,
  desc,
  price,
  selected = false,
  disabled = false,
  control = "radio",
  onClick,
  className,
}: OptionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-btn border p-3.5 text-left transition-colors",
        selected
          ? "border-ink shadow-[inset_0_0_0_1px_var(--color-ink)]"
          : "border-line hover:border-ink-2",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-[18px] shrink-0 place-items-center border",
          control === "checkbox" ? "rounded-[5px]" : "rounded-full",
          selected ? "border-ink" : "border-line",
        )}
      >
        {selected && (
          <span
            className={cn(
              "size-2.5 bg-ink",
              control === "checkbox" ? "rounded-[2px]" : "rounded-full",
            )}
          />
        )}
      </span>
      <span className="flex-1">
        <span className="block text-[14px] font-semibold text-ink">{title}</span>
        {desc && <span className="block text-[13px] text-soft">{desc}</span>}
      </span>
      {price != null && (
        <span className="shrink-0 text-right text-[14px] font-semibold text-ink">
          {price}
        </span>
      )}
    </button>
  );
}
