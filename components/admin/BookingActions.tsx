"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertWaitlist, refundDamage, refundWaitlist } from "@/app/admin/actions";
import { Button } from "@/components/ui/Button";
import { formatPence } from "@/lib/utils/money";

type Res = { ok: true } | { ok: false; error: string };

export function BookingActions({
  bookingId,
  tripId,
  status,
  damageStatus,
  reference,
  refundableTotal,
  damageRefundAmount,
}: {
  bookingId: string;
  tripId: string;
  status: string;
  damageStatus: string | null;
  /** Booking reference, shown in the confirm so a mis-click on the wrong row is visible. */
  reference?: string;
  /** Pence captured on the deposit intent - exactly what refundWaitlist sends back. */
  refundableTotal?: number | null;
  /** Pence held as a damage deposit, less any withholding - what refundDamage sends back. */
  damageRefundAmount?: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"waitlist" | "damage" | null>(null);

  const run = (fn: () => Promise<Res>) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      // Close the confirm either way: a refund that failed must be re-opened and
      // re-confirmed deliberately, never retried by a second click on a live panel.
      setConfirming(null);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });

  // Refunds move real money and cannot be undone, so both are two-step. The figure
  // shown is the one the server computes from the ledger, never a hardcoded deposit:
  // refundWaitlist returns everything captured, which for a pay-in-full waitlister
  // is trip cost + damage deposit, not £150 (audit #47, #53).
  const confirm =
    confirming === null
      ? null
      : confirming === "waitlist"
        ? {
            amount: refundableTotal ?? null,
            fallback: "everything captured on the deposit payment",
            action: () => refundWaitlist(bookingId, tripId),
          }
        : {
            amount: damageRefundAmount ?? null,
            fallback: "the held damage deposit",
            action: () => refundDamage(bookingId, tripId),
          };
  const forRef = reference ? ` for ${reference}` : "";

  return (
    <div className="flex flex-col items-end gap-1">
      {confirm ? (
        <div className="flex max-w-[15rem] flex-col items-end gap-2 rounded-btn border border-line bg-soft-panel p-2">
          <span className="text-right text-[11px] text-ink-2">
            Refund {confirm.amount == null ? confirm.fallback : formatPence(confirm.amount)}
            {forRef}? This happens straight away and cannot be undone.
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={() => run(confirm.action)}>
              {pending ? "Refunding…" : confirm.amount == null ? "Yes, refund" : `Yes, refund ${formatPence(confirm.amount)}`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-1">
          {status === "waitlisted" && (
            <>
              <Button size="sm" variant="out" disabled={pending} onClick={() => run(() => convertWaitlist(bookingId, tripId))}>
                Convert
              </Button>
              <Button size="sm" variant="out" disabled={pending} onClick={() => setConfirming("waitlist")}>
                {refundableTotal == null ? "Refund in full" : `Refund ${formatPence(refundableTotal)}`}
              </Button>
            </>
          )}
          {(status === "confirmed" || status === "converted") && damageStatus === "held" && (
            <Button size="sm" variant="out" disabled={pending} onClick={() => setConfirming("damage")}>
              {damageRefundAmount == null ? "Refund damage" : `Refund damage ${formatPence(damageRefundAmount)}`}
            </Button>
          )}
        </div>
      )}
      {err && (
        <span role="alert" className="text-right text-[11px] text-err">
          {err}
        </span>
      )}
    </div>
  );
}
