import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeClient } from "./fake-supabase";

/**
 * The Postgres-backed limiter. The behaviour that matters is the contract it
 * sends to the database and what it does when the database cannot answer -
 * the previous Upstash version silently allowed EVERY request because its creds
 * were never set, so "allows when it shouldn't" is the regression to guard.
 */

const h = vi.hoisted(() => ({ admin: { value: undefined as unknown }, hdrs: new Map<string, string>() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin.value }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => h.hdrs.get(k) ?? null }) }));

async function load() {
  return import("@/lib/ratelimit");
}

beforeEach(() => {
  vi.resetModules();
  h.hdrs = new Map();
});

describe("rateLimit", () => {
  it("allows when the database says allowed", async () => {
    h.admin.value = createFakeClient({ rpc: { rate_limit_check: { data: true } } });
    const { rateLimit } = await load();
    expect(await rateLimit("payment", "user-1")).toBe(true);
  });

  it("refuses when the database says refused", async () => {
    h.admin.value = createFakeClient({ rpc: { rate_limit_check: { data: false } } });
    const { rateLimit } = await load();
    expect(await rateLimit("payment", "user-1")).toBe(false);
  });

  it("sends the bucket, limit and window the migration expects", async () => {
    const db = createFakeClient({ rpc: { rate_limit_check: { data: true } } });
    h.admin.value = db;
    const { rateLimit } = await load();
    await rateLimit("tripCode", "203.0.113.7");

    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0].name).toBe("rate_limit_check");
    expect(db.rpcCalls[0].args).toEqual({
      p_bucket: "tripCode:203.0.113.7",
      p_limit: 10,
      p_window: "1 minute",
    });
  });

  it("gives payment a larger allowance than trip-code guessing", async () => {
    const db = createFakeClient({ rpc: { rate_limit_check: { data: true } } });
    h.admin.value = db;
    const { rateLimit } = await load();
    await rateLimit("tripCode", "x");
    await rateLimit("payment", "x");

    const [trip, pay] = db.rpcCalls.map((c) => (c.args as { p_limit: number }).p_limit);
    expect(trip).toBe(10);
    expect(pay).toBe(20);
  });

  // Namespacing: a user's payment quota must not be spent by their trip-code
  // attempts, and two users must never share a bucket.
  it("keeps buckets separate per kind and per id", async () => {
    const db = createFakeClient({ rpc: { rate_limit_check: { data: true } } });
    h.admin.value = db;
    const { rateLimit } = await load();
    await rateLimit("payment", "a");
    await rateLimit("payment", "b");
    await rateLimit("tripCode", "a");

    const buckets = db.rpcCalls.map((c) => (c.args as { p_bucket: string }).p_bucket);
    expect(new Set(buckets).size).toBe(3);
  });

  // A limiter is an abuse control, not an authorisation check. Every caller has
  // already passed its own auth guard, and a database that cannot answer this
  // cannot serve the action behind it either - so failing closed would turn a
  // blip into an outage while denying an attacker nothing.
  it("fails OPEN when the database returns an error", async () => {
    h.admin.value = createFakeClient({
      rpc: { rate_limit_check: { error: { message: "connection refused" } } },
    });
    const { rateLimit } = await load();
    expect(await rateLimit("payment", "user-1")).toBe(true);
  });

  it("fails OPEN when the client throws", async () => {
    h.admin.value = {
      rpc: () => {
        throw new Error("socket hang up");
      },
    };
    const { rateLimit } = await load();
    expect(await rateLimit("payment", "user-1")).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first hop from x-forwarded-for", async () => {
    h.hdrs.set("x-forwarded-for", "203.0.113.7, 70.41.3.18, 150.172.238.178");
    const { clientIp } = await load();
    // The client's own address is the FIRST entry; later hops are proxies, and
    // keying on a proxy would put unrelated students in one bucket.
    expect(await clientIp()).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a constant", async () => {
    h.hdrs.set("x-real-ip", "198.51.100.4");
    const { clientIp } = await load();
    expect(await clientIp()).toBe("198.51.100.4");

    vi.resetModules();
    h.hdrs = new Map();
    const again = await load();
    expect(await again.clientIp()).toBe("unknown");
  });
});
