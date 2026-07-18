import * as Sentry from "@sentry/nextjs";

/**
 * Browser Sentry init (replaces the old sentry.client.config.ts convention).
 * ENV-GATED on the PUBLIC DSN (a DSN is publishable, not a secret; it must be
 * NEXT_PUBLIC_ to be inlined into the client bundle). No Session Replay — it
 * records the DOM and would capture passport/DOB/payment fields. Same beforeSend
 * scrub as the server. Browser events are tunnelled same-origin (see
 * tunnelRoute in next.config.ts), so no CSP connect-src change is needed.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        if (event.request.url) event.request.url = event.request.url.split("?")[0];
      }
      return event;
    },
  });
}

// Instruments client-side App Router navigations for tracing. Exported
// unconditionally; it's a no-op reference until init runs.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
