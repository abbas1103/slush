import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { headers } from "next/headers";

/**
 * Managed rate limiting (Upstash). Env-gated: with no Upstash creds configured
 * every check passes (no-op), so it's inert in local dev and activates the
 * moment the creds are set. Sliding-window, keyed by IP or user id.
 */
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

type Window = `${number} s` | `${number} m`;
function make(limit: number, window: Window): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), prefix: "slush-rl" });
}

const limiters = {
  tripCode: make(10, "1 m"), // brute-force surface: code guessing
  payment: make(20, "1 m"), // denial-of-wallet: intent creation
  auth: make(10, "1 m"),
};

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0].trim()) || h.get("x-real-ip") || "unknown";
}

/** Returns true if allowed. No-op (allows) when Upstash isn't configured. */
export async function rateLimit(kind: keyof typeof limiters, id: string): Promise<boolean> {
  const limiter = limiters[kind];
  if (!limiter) return true;
  const { success } = await limiter.limit(`${kind}:${id}`);
  return success;
}
