import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/**
 * Button styling from the prototype `.btn` / `.btn-dark|out|ghost` / `.pill`.
 * Exported `buttonVariants` lets a Next <Link> be styled as a button without a
 * Slot dependency: <Link className={buttonVariants({ variant: "dark" })}>.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[9px] whitespace-nowrap font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        dark: "bg-ink text-white hover:bg-ink-hover",
        out: "border border-line bg-surface text-ink hover:bg-soft-panel",
        ghost: "bg-transparent text-soft hover:text-ink",
      },
      size: {
        default: "px-[22px] py-[13px] text-[15px]",
        sm: "px-4 py-2 text-[13px]",
      },
      pill: {
        true: "rounded-full",
        false: "rounded-btn",
      },
    },
    defaultVariants: { variant: "dark", size: "default", pill: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, pill, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, pill }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
