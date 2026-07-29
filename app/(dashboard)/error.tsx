"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Button, buttonVariants } from "@/components/ui/Button";

/**
 * Error boundary for the dashboard area (/dashboard, /tickets, /account, /help).
 *
 * lib/db/queries.ts throws on a failed read rather than swallowing it - a
 * swallowed error showed a student who had paid an empty dashboard, which is
 * worse than an error. But without a boundary here that throw escaped to
 * app/global-error.tsx, which replaces the root layout with an unstyled
 * fallback. This keeps the failure inside the SLUSH chrome with a retry.
 *
 * The copy makes no claim about payment state: this can fire on a read that had
 * nothing to do with money.
 */
export default function DashboardError({
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
        We couldn&apos;t load this page. Your booking and any payment you&apos;ve made are safe - try
        again in a moment, and get in touch if it keeps happening.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/help" className={buttonVariants({ variant: "out" }) + " inline-flex"}>
          Get help
        </Link>
      </div>
    </div>
  );
}
