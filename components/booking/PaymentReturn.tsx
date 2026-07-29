"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { reconcilePayment } from "@/app/(booking)/book/actions";

// The redirect handoff is exactly where a connection drops, so a single failed
// reconcile must not be the end of it (audit #83). Retrying is safe: the action
// is idempotent (it re-enters the same RPC as the webhook).
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1500;

/**
 * Handles the return leg of a redirect-based payment (Amazon Pay, 3DS, etc.).
 * Stripe appends ?payment_intent=… to the return URL; we reconcile it
 * server-side (idempotent) so the booking finalises even if the webhook lags.
 */
export function PaymentReturn({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const phase = useRef<"idle" | "running" | "done">("idle");

  useEffect(() => {
    if (phase.current !== "idle") return;
    const pi = new URLSearchParams(window.location.search).get("payment_intent");
    if (!pi) return;
    phase.current = "running";

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function attempt(n: number, intentId: string) {
      let settled = false;
      try {
        const r = await reconcilePayment(bookingId, intentId);
        // 'processing' means the charge hasn't settled yet, so there is nothing
        // to finalise on this pass - come back to it.
        settled = r.ok && r.status !== "processing" && r.status !== "requires_action";
      } catch {
        // Transport failure - retry rather than swallowing it.
      }
      if (cancelled) return;
      if (settled) {
        phase.current = "done";
        // Drop the Stripe return query (?payment_intent=…) from the address bar,
        // staying on the current path, then re-fetch.
        window.history.replaceState(null, "", window.location.pathname);
        router.refresh();
        return;
      }
      if (n + 1 >= MAX_ATTEMPTS) {
        // Out of attempts: leave ?payment_intent=… in the URL so a reload picks
        // it up again, and let StatusPoller tell the student where they stand.
        phase.current = "idle";
        return;
      }
      timer = setTimeout(() => attempt(n + 1, intentId), BASE_DELAY_MS * 2 ** n);
    }

    attempt(0, pi);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Unmounted mid-flight: let a remount pick the reconcile up again.
      if (phase.current === "running") phase.current = "idle";
    };
  }, [bookingId, router]);

  return null;
}
