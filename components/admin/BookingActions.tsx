"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertWaitlist, refundDamage, refundWaitlist } from "@/app/admin/actions";
import { Button } from "@/components/ui/Button";

type Res = { ok: true } | { ok: false; error: string };

export function BookingActions({
  bookingId,
  tripId,
  status,
  damageStatus,
}: {
  bookingId: string;
  tripId: string;
  status: string;
  damageStatus: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<Res>) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {status === "waitlisted" && (
          <>
            <Button size="sm" variant="out" disabled={pending} onClick={() => run(() => convertWaitlist(bookingId, tripId))}>
              Convert
            </Button>
            <Button size="sm" variant="out" disabled={pending} onClick={() => run(() => refundWaitlist(bookingId, tripId))}>
              Refund £150
            </Button>
          </>
        )}
        {(status === "confirmed" || status === "converted") && damageStatus === "held" && (
          <Button size="sm" variant="out" disabled={pending} onClick={() => run(() => refundDamage(bookingId, tripId))}>
            Refund damage
          </Button>
        )}
      </div>
      {err && <span className="text-right text-[11px] text-err">{err}</span>}
    </div>
  );
}
