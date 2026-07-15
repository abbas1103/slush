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

/** Trip-detail CTA: starts a booking (server hold) then opens the hold modal. */
export function BookButton({ code, isFull }: { code: string; isFull: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hold, setHold] = useState<Hold | null>(null);
  const [error, setError] = useState<string | null>(null);

  function begin() {
    setError(null);
    startTransition(async () => {
      const r = await startBooking(code);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setHold({ bookingId: r.bookingId, isWaitlist: r.isWaitlist, expiresAt: r.expiresAt });
    });
  }

  async function release() {
    const current = hold;
    setHold(null);
    if (current) await releaseHold(current.bookingId);
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
