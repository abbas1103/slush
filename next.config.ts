import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pin Turbopack's workspace root to THIS project. Otherwise Next 16 walks up the
// tree, finds a lockfile in a parent dir (another project on this machine),
// infers the wrong root, and Turbopack panics with "Next.js package not found".
// https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Static security headers. The Content-Security-Policy is NOT here - it's set
 * per-request in `proxy.ts` so it can carry a fresh nonce and drop
 * 'unsafe-inline' in production (see buildCsp there). These headers are static
 * and env-independent, so they stay in the Next config.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `payment` is delegated to Stripe's origin as well as our own: the Payment
  // Element renders in a cross-origin iframe from js.stripe.com, so with
  // `payment=(self)` alone the browser denies its Payment Request API call and
  // the Apple Pay / Google Pay button never appears - the student is silently
  // dropped to manual card entry on the one revenue path in the app.
  {
    key: "Permissions-Policy",
    value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")',
  },
];

const nextConfig: NextConfig = {
  turbopack: { root: projectRoot },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

/**
 * Wrap with Sentry ONLY when a DSN is configured. With no Sentry env (CI/local
 * placeholder builds) the plugin is never invoked → zero warnings, clean build.
 * `tunnelRoute` routes browser events same-origin (covered by the CSP's
 * `connect-src 'self'`, so no CSP change) and dodges ad-blockers - proxy.ts
 * excludes `/monitoring` from its matcher so the tunnel isn't intercepted.
 * Source-map upload is gated on SENTRY_AUTH_TOKEN so tokenless builds pass.
 */
const sentryEnabled = !!(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      tunnelRoute: "/monitoring",
      // The SDK sits in the chunk every route loads eagerly, including content
      // pages with no interactivity, so tree-shake its own debug/logging code
      // out of the browser bundle. Session Replay is deliberately off (it would
      // record passport/DOB/card fields), so the excludeReplay* flags would be
      // no-ops here and are left out.
      bundleSizeOptimizations: { excludeDebugStatements: true },
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      widenClientFileUpload: true,
      telemetry: false,
      silent: !process.env.CI,
    })
  : nextConfig;
