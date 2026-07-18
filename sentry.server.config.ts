import * as Sentry from "@sentry/nextjs";

/**
 * Node.js-runtime Sentry init, lazily imported by instrumentation.ts register().
 * ENV-GATED: with no SENTRY_DSN the SDK never initializes — no client, no
 * network, no global handlers (fully inert for CI/local/no-Sentry deploys).
 * PII-scrubbed: sendDefaultPii off + a beforeSend that strips request-derived
 * data before any event leaves the process (this app handles passports/DOB).
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data; // request/response bodies
        delete event.request.cookies;
        delete event.request.headers;
        if (event.request.url) event.request.url = event.request.url.split("?")[0]; // drop query string
      }
      return event;
    },
  });
}
