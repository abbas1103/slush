"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/observability/report";

/**
 * Root error boundary for uncaught client-side React render errors (which
 * onRequestError does not cover). Reports via the same-origin beacon, which hands
 * off to the server Sentry SDK (inert if no DSN), and shows a minimal fallback.
 * Must render its own <html>/<body>.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    reportClientError(error);
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
