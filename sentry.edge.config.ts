import * as Sentry from "@sentry/nextjs";

/**
 * Edge-runtime Sentry init (middleware / proxy.ts + edge routes), lazily
 * imported by instrumentation.ts register(). Same env-gate + PII scrubbing as
 * the server config.
 */
const dsn = process.env.SENTRY_DSN;

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
