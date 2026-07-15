import type { NextConfig } from "next";

/**
 * Content-Security-Policy allowlist for the origins the browser actually talks
 * to: Stripe (Elements + 3DS frames), Supabase (REST/auth/realtime), Cloudflare
 * Turnstile. Everything else is denied. Upstash is server-side only, so it's
 * not listed (CSP governs the browser). NOTE: script-src uses 'unsafe-inline'
 * as a pragmatic v1 — a nonce-based CSP (via the middleware) is the follow-up.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://challenges.cloudflare.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
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
