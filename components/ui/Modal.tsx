"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Accessible dialog title id target; pass a heading with this id inside. */
  labelledBy?: string;
  className?: string;
  /** Whether clicking the scrim / pressing Esc closes it (default true). */
  dismissible?: boolean;
}

/**
 * `.overlay` scrim + `.modal` card. Portals to <body>, traps focus, closes on
 * Esc and scrim click, and locks background scroll. Honours reduced-motion via
 * the global stylesheet.
 */
export function Modal({
  open,
  onClose,
  children,
  labelledBy,
  className,
  dismissible = true,
}: ModalProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  // Held in a ref so a parent re-render with a fresh onClose cannot tear down
  // the focus capture and scroll lock while the dialog is open.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const getFocusable = (): HTMLElement[] => {
      const node = dialogRef.current;
      if (!node) return [];
      return Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
    };

    // Move focus into the dialog.
    const focusFirst = () => {
      const node = dialogRef.current;
      if (!node) return;
      (getFocusable()[0] ?? node).focus();
    };
    focusFirst();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const node = dialogRef.current;
      if (!node) return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Focus can sit outside the dialog altogether - clicking the scrim of a
      // non-dismissible modal leaves it on <body> - so recapture it before the
      // edge checks, otherwise Tab walks into the page behind the scrim.
      if (!node.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, dismissible]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(10,10,12,.55)" }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[20px] bg-surface p-6 shadow-xl outline-none",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
