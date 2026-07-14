import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/** `.card` from the prototype: white surface with a hairline border, 16px radius. */
const cardVariants = cva("rounded-card", {
  variants: {
    tone: {
      surface: "border border-line bg-surface text-ink",
      dark: "bg-panel text-white",
    },
    padding: {
      none: "",
      sm: "p-[18px]",
      default: "p-5",
      lg: "p-[22px]",
    },
  },
  defaultVariants: { tone: "surface", padding: "default" },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, tone, padding, ...props }: CardProps) {
  return (
    <div className={cn(cardVariants({ tone, padding }), className)} {...props} />
  );
}
