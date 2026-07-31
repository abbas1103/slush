/**
 * Client error reporting without the Sentry browser SDK.
 *
 * The SDK was ~150 KB gzipped sitting in the chunk EVERY route loads eagerly,
 * including /privacy and /terms - not because of the init hook, but because the
 * four client error boundaries imported it, and error boundaries live in the root
 * layout tree. Its own `bundleSizeOptimizations` flags are no-ops here: the
 * tree-shaking defines are injected only by @sentry/nextjs's webpack path, and
 * this project builds with Turbopack (verified by building with the flags on, off,
 * and absent - byte-identical output every time).
 *
 * So the browser posts a tiny envelope same-origin instead, and the SERVER SDK
 * reports it. Costs well under a kilobyte and needs no CSP change: `connect-src
 * 'self'` in proxy.ts already covers it.
 *
 * What this deliberately does NOT send: stacks, request bodies, cookies, query
 * strings, or anything a student typed. React already reduces a server-render
 * error to an opaque `digest` in production, and the fields below are capped and
 * scrubbed again server-side. This app holds passport numbers and DOBs, so an
 * error reporter is exactly the wrong place to get relaxed about payloads.
 */

/** Keep the envelope small; the route caps these again and does not trust them. */
const MAX_MESSAGE = 300;

export interface ClientErrorReport {
  message: string;
  digest?: string;
  pathname: string;
}

/**
 * Fire-and-forget. `sendBeacon` is used first because it survives the page being
 * torn down, which is the common case for a render error the user reacts to by
 * navigating away. Never throws and never returns a rejected promise: a failure
 * to report an error must not itself break the error boundary.
 */
export function reportClientError(error: Error & { digest?: string }): void {
  try {
    if (typeof window === "undefined") return;

    const body: ClientErrorReport = {
      // Strip anything that looks like a query string before it is truncated.
      message: String(error?.message ?? "Unknown client error").slice(0, MAX_MESSAGE),
      digest: error?.digest,
      pathname: window.location.pathname,
    };
    const payload = JSON.stringify(body);

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // text/plain avoids a CORS preflight; the route parses the body itself.
      const blob = new Blob([payload], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon("/api/client-error", blob)) return;
    }

    // Fallback for browsers without sendBeacon, or when it refuses (queue full).
    void fetch("/api/client-error", {
      method: "POST",
      body: payload,
      headers: { "content-type": "text/plain;charset=UTF-8" },
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting is best-effort by design.
  }
}
