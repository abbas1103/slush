import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rate limiting, backed by Postgres (`rate_limit_check`). Sliding window, keyed
 * by IP or user id.
 *
 * Previously Upstash Redis, which was never configured in any environment - and
 * the old implementation returned true when unconfigured, so every check silently
 * passed. Using the database we already run removes the vendor, the two secrets
 * and the "configured?" branch that hid the failure. See the migration for why
 * Postgres is the right size of hammer here, and why the RPC is service-role only.
 *
 * Service-role, deliberately: the bucket is a parameter, so anyone who can call
 * the function can burn anyone else's quota.
 */

const LIMITS = {
  /** Brute-force surface: trip-code guessing. */
  tripCode: { limit: 10, window: "1 minute" },
  /** Denial-of-wallet: PaymentIntent creation, and scanner check-ins. */
  payment: { limit: 20, window: "1 minute" },
  /**
   * Client error reports (/api/client-error). Unauthenticated by necessity - a
   * boundary can fire before or instead of a session - so it needs a cap: without
   * one it is an open pipe into our Sentry quota. A real user hits a handful of
   * boundaries a minute at worst; a render loop hits thousands.
   */
  clientError: { limit: 10, window: "1 minute" },
} as const;

export type RateLimitKind = keyof typeof LIMITS;

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Returns true if the call is allowed.
 *
 * FAILS OPEN if the database cannot answer. The limiter guards against abuse,
 * not against unauthorised access - every caller has already passed its own
 * auth check - and a database that cannot serve this query cannot serve the
 * action behind it either, so failing closed would convert a blip into an
 * outage without denying an attacker anything.
 */
export async function rateLimit(kind: RateLimitKind, id: string): Promise<boolean> {
  const { limit, window } = LIMITS[kind];
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_check", {
      p_bucket: `${kind}:${id}`,
      p_limit: limit,
      p_window: window,
    });
    if (error) {
      console.error(`[ratelimit] ${kind} check failed, allowing:`, error.message);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error(`[ratelimit] ${kind} check threw, allowing:`, e);
    return true;
  }
}
