import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** `.f` field wrapper: a soft `.l` label above the control, with optional hint/error. */
export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  return (
    <label htmlFor={htmlFor} className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <span className="text-[13px] font-medium text-soft">{label}</span>
      )}
      {children}
      {error ? (
        <span className="text-[12.5px] text-err">{error}</span>
      ) : hint ? (
        <span className="text-[12.5px] text-soft">{hint}</span>
      ) : null}
    </label>
  );
}
