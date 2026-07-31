"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startBooking, releaseHold } from "@/app/(booking)/book/actions";
import { Button } from "@/components/ui/Button";
import { HoldModal } from "./HoldModal";

interface Hold {
  bookingId: string;
  isWaitlist: boolean;
  expiresAt: string;
}

/**
 * Trip-detail CTA: starts a booking (server hold) then opens the hold modal.
 *
 * `initialHold` is the student's existing live hold, read server-side. It seeds
 * the state so a page refresh rebuilds the reservation panel instead of dropping
 * it - previously the hold existed only in client state, so reloading lost the
 * countdown and left no way to reach or release a place still being held.
 * Rehydrating by calling startBooking() again would be wrong: its SQL releases
 * the current hold and inserts a new one, silently restarting the 30 minutes.
 */
export function BookButton({
  code,
  isFull,
  initialHold = null,
}: {
  code: string;
  isFull: boolean;
  initialHold?: Hold | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hold, setHold] = useState<Hold | null>(initialHold);
  const [error, setError] = useState<string | null>(null);

  function begin() {
    setError(null);
    startTransition(async () => {
      const r = await startBooking(code);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Already confirmed, waitlisted or converted: there is no hold and no
      // expiry, so opening the countdown modal would show an expired timer for a
      // booking that is actually secured. Send them to the booking instead.
      if (r.placed) {
        router.push(
          r.status === "pending" ? `/book/${r.bookingId}/extras` : `/book/${r.bookingId}/confirmation`,
        );
        return;
      }
      setHold({ bookingId: r.bookingId, isWaitlist: r.isWaitlist, expiresAt: r.expiresAt });
    });
  }

  async function release() {
    const current = hold;
    if (!current) return;
    setError(null);
    // Optimistic, but only until the server answers: releaseHold refuses while a
    // payment is still in flight, and closing the panel regardless told the
    // student their place was released when it was not. Put it back and say so.
    setHold(null);
    const r = await releaseHold(current.bookingId);
    if (!r.ok) {
      setHold(current);
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Button className="mt-3 w-full" onClick={begin} disabled={pending}>
        {pending ? "Reserving…" : isFull ? "Join the waiting list →" : "Book this trip →"}
      </Button>
      {error && <p className="mt-2 text-center text-[13px] text-err">{error}</p>}
      <HoldModal
        open={!!hold}
        expiresAt={hold?.expiresAt ?? ""}
        isWaitlist={hold?.isWaitlist ?? false}
        onFinish={() => hold && router.push(`/book/${hold.bookingId}/extras`)}
        onRelease={release}
      />
    </>
  );
}
