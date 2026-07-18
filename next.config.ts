import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Static security headers. The Content-Security-Policy is NOT here — it's set
 * per-request in `proxy.ts` so it can carry a fresh nonce and drop
 * 'unsafe-inline' in production (see buildCsp there). These headers are static
 * and env-independent, so they stay in the Next config.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

/**
 * Wrap with Sentry ONLY when a DSN is configured. With no Sentry env (CI/local
 * placeholder builds) the plugin is never invoked → zero warnings, clean build.
 * `tunnelRoute` routes browser events same-origin (covered by the CSP's
 * `connect-src 'self'`, so no CSP change) and dodges ad-blockers — proxy.ts
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
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      widenClientFileUpload: true,
      telemetry: false,
      silent: !process.env.CI,
    })
  : nextConfig;
