import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/**
 * Status pills from the prototype: `.green-pill` (success), `.black-pill`,
 * `.tag`, and the red waitlist/error variant. `dot` renders the small leading
 * dot in the current text colour (e.g. green for success).
 */
const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full font-semibold",
  {
    variants: {
      variant: {
        success: "bg-okbg px-[11px] py-1 text-[12.5px] text-ok",
        error: "bg-errbg px-[11px] py-1 text-[12.5px] text-err",
        black: "bg-ink px-[11px] py-1 text-[11px] font-bold uppercase tracking-wide text-white",
        tag: "bg-chip px-[11px] py-1 text-[12.5px] text-ink-2",
      },
    },
    defaultVariants: { variant: "success" },
  },
);

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  dot?: boolean;
}

export function Pill({ className, variant, dot, children, ...props }: PillProps) {
  return (
    <span className={cn(pillVariants({ variant }), className)} {...props}>
      {dot && <span aria-hidden className="size-[7px] rounded-full bg-current" />}
      {children}
    </span>
  );
}
