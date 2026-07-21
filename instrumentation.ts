import * as Sentry from "@sentry/nextjs";

/**
 * Next 16 instrumentation hook. Dynamically imports the runtime-matching Sentry
 * config so the Node/Edge SDK never loads in the browser bundle. Each config is
 * itself env-gated on SENTRY_DSN, so this is a no-op when Sentry isn't configured.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// App Router error hook - captures Server Component / route-handler / middleware
// errors. No-op until Sentry.init has run (i.e. when a DSN is set).
export const onRequestError = Sentry.captureRequestError;
