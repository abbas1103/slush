import type { NextConfig } from "next";

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

export default nextConfig;
