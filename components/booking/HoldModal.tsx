"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * 30-minute hold modal. The countdown is derived from the server's expires_at
 * (so it survives reload); the server is the real authority - expired holds are
 * freed lazily server-side regardless of this UI.
 */
export function HoldModal({
  open,
  expiresAt,
  isWaitlist,
  onFinish,
  onRelease,
}: {
  open: boolean;
  expiresAt: string;
  isWaitlist: boolean;
  onFinish: () => void;
  onRelease: () => void;
}) {
  const [clock, setClock] = useState<{ deadline: number; remaining: number } | null>(null);

  useEffect(() => {
    if (!open || !expiresAt) return;
    const deadline = new Date(expiresAt).getTime();
    const tick = () => setClock({ deadline, remaining: deadline - Date.now() });
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open, expiresAt]);

  // The countdown only counts once it has been read for THIS hold. The effect
  // runs after the first paint, so treating "not read yet" as 0 would flash
  // "0:00" and "your place has been released" at the very moment a place was
  // reserved - and would show the previous hold's time on a reopen (audit #77).
  const deadline = expiresAt ? new Date(expiresAt).getTime() : 0;
  const current = clock && clock.deadline === deadline ? clock : null;
  const expired = current !== null && current.remaining <= 0;

  return (
    <Modal open={open} onClose={onRelease} labelledBy="hold-title" dismissible={false}>
      <h2 id="hold-title">
        {isWaitlist ? "Your waiting-list spot is reserved ⏳" : "Your place is reserved 🔒"}
      </h2>
      <div className="mt-4 text-center">
        <div className="text-[40px] font-extrabold tabular-nums">
          {current ? format(current.remaining) : "--:--"}
        </div>
        <div className="text-[12px] text-soft">remaining</div>
      </div>
      <p className="mt-4 text-[14px] text-soft">
        {isWaitlist
          ? "We're holding your waiting-list spot for 30 minutes. Finish to secure your place in the queue - you'll pay the deposit, fully refundable if no place opens."
          : "We're holding your place for the next 30 minutes. Finish your booking to secure it."}
      </p>

      {expired ? (
        <div className="mt-5">
          <p className="text-[13px] text-err">This hold has expired - your place has been released.</p>
          <Button variant="out" className="mt-3 w-full" onClick={onRelease}>
            Back to the trip
          </Button>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-2">
          <Button className="w-full" onClick={onFinish}>
            Finish my booking →
          </Button>
          <Button variant="ghost" className="w-full" onClick={onRelease}>
            Release my place
          </Button>
        </div>
      )}
    </Modal>
  );
}
