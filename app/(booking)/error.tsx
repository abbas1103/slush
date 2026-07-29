"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Button, buttonVariants } from "@/components/ui/Button";

/**
 * Error boundary for the booking area, so a failed query mid-flow renders inside
 * the SLUSH chrome with a retry instead of falling through to global-error.tsx's
 * bare fallback. Reports to Sentry (no-op if not configured).
 *
 * The copy deliberately makes no claim about whether a payment went through -
 * this boundary can fire on the confirmation screen, after the charge.
 */
export default function BookingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[1120px] px-6 py-16 text-center">
      <h1>Something went wrong</h1>
      <p className="mx-auto mt-2 max-w-[440px] text-soft">
        We couldn&apos;t load this step. Your booking and any payment you&apos;ve made are safe - try
        again, or open your dashboard to see where things stand.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "out" }) + " inline-flex"}>
          Go to my dashboard
        </Link>
      </div>
    </div>
  );
}
