"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { reconcilePayment } from "@/app/(booking)/book/actions";

/**
 * Handles the return leg of a redirect-based payment (Amazon Pay, 3DS, etc.).
 * Stripe appends ?payment_intent=… to the return URL; we reconcile it
 * server-side (idempotent) so the booking finalises even if the webhook lags.
 */
export function PaymentReturn({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    const pi = new URLSearchParams(window.location.search).get("payment_intent");
    if (!pi) return;
    done.current = true;
    reconcilePayment(bookingId, pi).then((r) => {
      if (r.ok) {
        // Drop the Stripe return query (?payment_intent=…) from the address bar,
        // staying on the current path, then re-fetch.
        window.history.replaceState(null, "", window.location.pathname);
        router.refresh();
      }
    });
  }, [bookingId, router]);

  return null;
}
