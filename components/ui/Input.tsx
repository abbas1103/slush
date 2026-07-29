import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * 16px below `lg`: iOS Safari zooms the viewport on focus for anything smaller
 * and never zooms back out. The prototype's 15px is kept from 820px up, where
 * the zoom behaviour does not apply.
 */
const controlBase =
  "w-full rounded-btn border border-line bg-surface px-3.5 py-2.5 text-[16px] text-ink outline-none transition-colors placeholder:text-placeholder focus:border-ink disabled:opacity-50 lg:text-[15px]";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(controlBase, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(controlBase, "resize-y", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(controlBase, "appearance-none pr-9", className)} {...props} />
));
Select.displayName = "Select";
