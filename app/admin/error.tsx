"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Button, buttonVariants } from "@/components/ui/Button";

/**
 * Error boundary for the CMS. The admin queries throw on a failed or TRUNCATED
 * read (a short passenger manifest is worse than no manifest), so this is a
 * routine path here rather than an exceptional one, and an admin needs to see
 * that a list failed rather than a plausible-looking partial one.
 *
 * Deliberately shows the message: the reader is the operator, the admin queries
 * put no student PII in their error strings, and "which read failed" is exactly
 * what makes it actionable.
 */
export default function AdminError({
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
    <div className="py-16 text-center">
      <h1>This screen didn&apos;t load</h1>
      <p className="mx-auto mt-2 max-w-[520px] text-soft">
        Nothing has been changed. If this was an export, do not send the file - it may be
        incomplete.
      </p>
      <p className="mx-auto mt-3 max-w-[520px] rounded-btn bg-soft-panel px-4 py-3 text-left font-mono text-[12px] break-words text-soft">
        {error.message}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/admin" className={buttonVariants({ variant: "out" }) + " inline-flex"}>
          Back to trips
        </Link>
      </div>
    </div>
  );
}
