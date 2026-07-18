"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Root error boundary for uncaught client-side React render errors (which
 * onRequestError does not cover). Reports to Sentry (no-op if not configured)
 * and shows a minimal fallback. Must render its own <html>/<body>.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <h1>Something went wrong</h1>
          <p>Please refresh the page or try again in a moment.</p>
        </div>
      </body>
    </html>
  );
}
