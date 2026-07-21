import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  children?: React.ReactNode;
}

/**
 * `.cbox` custom checkbox: a native checkbox (visually hidden, keyboard- and
 * screen-reader-accessible) driving a styled 19px box. The white tick is always
 * rendered - invisible on the white unchecked box, visible on the ink checked box.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, children, ...props }, ref) => (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 text-[14px] text-ink-2",
        className,
      )}
    >
      <input ref={ref} type="checkbox" className="peer sr-only" {...props} />
      <span
        aria-hidden
        className="mt-px flex size-[19px] shrink-0 items-center justify-center rounded-[5px] border border-line bg-surface text-white transition-colors peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {children && <span>{children}</span>}
    </label>
  ),
);
Checkbox.displayName = "Checkbox";
