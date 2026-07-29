import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/stripe/webhook/route";
import { createFakeClient, type FakeClient, type FakeClientOptions } from "./fake-supabase";

/**
 * The webhook is the ONLY writer of the ledger, so what matters is not that it
 * returns 200 but which of these it does: verify the signature, refuse to
 * double-write a replayed event, re-drive an event that was recorded but never
 * finished, pass Stripe's ACTUAL captured amount to the finalize RPC, and leave
 * the event unprocessed (5xx, so Stripe retries) whenever anything fails.
 */

const h = vi.hoisted(() => ({
  admin: { value: undefined as unknown },
  constructEvent: vi.fn<(body: string, signature: string, secret: string) => unknown>(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin.value }));
vi.mock("@/lib/stripe/server", () => ({
  stripe: { webhooks: { constructEvent: h.constructEvent } },
}));
// The signing secret moved to its own module so a missing one fails only the
// webhook, not the booking flow (review #5). Mock it here rather than relying on
// vitest.config.ts's env, so the test controls what it verifies against.
vi.mock("@/lib/stripe/webhook-secret", () => ({ stripeWebhookSecret: "whsec_test" }));

const EVENT_ID = "evt_1TestEvent";
const BOOKING_ID = "44444444-4444-4444-4444-444444444444";
const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

interface EventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function succeeded(
  metadata: Record<string, string>,
  intent: Record<string, unknown> = {},
): EventLike {
  return {
    id: EVENT_ID,
    type: "payment_intent.succeeded",
    data: {
      object: { id: "pi_123", amount: 15000, latest_charge: "ch_123", metadata, ...intent },
    },
  };
}

let logged: string[] = [];

function setup(overrides: FakeClientOptions = {}): FakeClient {
  const db = createFakeClient({
    ...overrides,
    tables: { stripe_events: [], payments: [], ...overrides.tables },
    rpc: { record_payment_and_finalize: { data: "confirmed" }, ...overrides.rpc },
  });
  h.admin.value = db;
  return db;
}

/** Deliver an event, with a signature header unless told otherwise. */
async function deliver(event: EventLike, headers: Record<string, string> = { "stripe-signature": "t=1,v1=sig" }) {
  const body = JSON.stringify(event);
  h.constructEvent.mockReturnValue(event);
  return await POST(new Request("https://slush.test/api/stripe/webhook", { method: "POST", body, headers }));
}

function finalizeCalls(db: FakeClient) {
  return db.rpcCalls.filter((call) => call.name === "record_payment_and_finalize");
}

function processedAt(db: FakeClient): unknown {
  return db.rows("stripe_events")[0]?.processed_at;
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map((arg) => String(arg)).join(" "));
  });
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
});

describe("the Stripe webhook verifies before it writes", () => {
  it("rejects a delivery with no signature header and touches nothing", async () => {
    const db = setup();
    const response = await deliver(succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }), {});
    expect(response.status).toBe(400);
    expect(h.constructEvent).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it("rejects an invalid signature and writes nothing", async () => {
    const db = setup();
    h.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    const body = JSON.stringify(succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }));
    const response = await POST(
      new Request("https://slush.test/api/stripe/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": "t=1,v1=forged" },
      }),
    );
    expect(response.status).toBe(400);
    expect(db.calls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });
});

describe("the Stripe webhook finalizes with the amount Stripe captured", () => {
  it("drives the deposit finalize and marks the event processed", async () => {
    const db = setup();
    const response = await deliver(succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(finalizeCalls(db)).toEqual([
      {
        name: "record_payment_and_finalize",
        args: {
          p_booking_id: BOOKING_ID,
          p_intent_id: "pi_123",
          p_charge_id: "ch_123",
          p_kind: "deposit",
          p_amount_total: 15000,
        },
      },
    ]);
    expect(processedAt(db)).toBeTruthy();
  });

  it("passes the full charge for a pay-in-full, so the ledger can net off the damage hold", async () => {
    const db = setup();
    // £539 = £439 trip + £100 damage. The RPC records amount - damage as trip
    // money, so sending anything but the captured total under-records the trip.
    await deliver(
      succeeded({ booking_id: BOOKING_ID, payment_kind: "full" }, { amount: 53900 }),
    );
    expect(finalizeCalls(db)[0].args).toMatchObject({ p_kind: "full", p_amount_total: 53900 });
  });

  it("drives a balance top-up as a balance payment", async () => {
    const db = setup();
    await deliver(
      succeeded({ booking_id: BOOKING_ID, payment_kind: "balance" }, { amount: 20000 }),
    );
    expect(finalizeCalls(db)[0].args).toMatchObject({ p_kind: "balance", p_amount_total: 20000 });
  });

  it("sends an empty charge id rather than an object when the charge is expanded", async () => {
    const db = setup();
    await deliver(
      succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }, { latest_charge: { id: "ch_123" } }),
    );
    expect(finalizeCalls(db)[0].args).toMatchObject({ p_charge_id: "" });
  });

  it("does not silently ack a captured payment with no booking metadata", async () => {
    const db = setup();
    const response = await deliver(succeeded({}));
    expect(response.status).toBe(200); // retrying would not help; a human must act
    expect(finalizeCalls(db)).toEqual([]);
    expect(logged.some((line) => line.includes(EVENT_ID))).toBe(true);
  });

  it("writes nothing for an event type it does not handle, but still records it", async () => {
    const db = setup();
    const response = await deliver({
      id: EVENT_ID,
      type: "customer.created",
      data: { object: { id: "cus_123" } },
    });
    expect(response.status).toBe(200);
    expect(db.rpcCalls).toEqual([]);
    expect(processedAt(db)).toBeTruthy();
  });

  it("writes nothing for a failed payment - the hold expires on its own", async () => {
    const db = setup();
    const response = await deliver({
      id: EVENT_ID,
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_123", amount: 15000, metadata: { booking_id: BOOKING_ID } } },
    });
    expect(response.status).toBe(200);
    expect(db.rpcCalls).toEqual([]);
    expect(processedAt(db)).toBeTruthy();
  });
});

describe("the Stripe webhook is idempotent on the event id", () => {
  it("acks a replay of an event it already finished, without a second ledger write", async () => {
    const db = setup({
      tables: {
        stripe_events: [
          { id: EVENT_ID, type: "payment_intent.succeeded", processed_at: "2026-07-20T10:00:00.000Z" },
        ],
      },
      errors: { "stripe_events.insert": { message: "duplicate key value", code: "23505" } },
    });
    const response = await deliver(succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(finalizeCalls(db)).toEqual([]);
  });

  it("re-drives an event that was recorded but never finished", async () => {
    // Stripe's retry has to actually retry: the previous delivery 500ed after
    // recording the event, so the finalize never ran.
    const db = setup({
      tables: {
        stripe_events: [{ id: EVENT_ID, type: "payment_intent.succeeded", processed_at: null }],
      },
      errors: { "stripe_events.insert": { message: "duplicate key value", code: "23505" } },
    });
    const response = await deliver(succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }));
    expect(response.status).toBe(200);
    expect(finalizeCalls(db)).toHaveLength(1);
    expect(processedAt(db)).toBeTruthy();
  });

  it("re-drives rather than acks when it cannot tell whether the replay finished", async () => {
    const db = setup({
      errors: {
        "stripe_events.insert": { message: "duplicate key value", code: "23505" },
        "stripe_events.select": { message: "statement timeout", code: "57014" },
      },
    });
    const response = await deliver(succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }));
    expect(response.status).toBe(200);
    expect(finalizeCalls(db)).toHaveLength(1);
  });

  it("fails the delivery when the event cannot be recorded at all", async () => {
    const db = setup({
      errors: { "stripe_events.insert": { message: "permission denied", code: "42501" } },
    });
    const response = await deliver(succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }));
    expect(response.status).toBe(500); // Stripe retries; nothing is finalized twice
    expect(finalizeCalls(db)).toEqual([]);
  });
});

describe("the Stripe webhook fails loudly rather than losing money", () => {
  it("returns 5xx and leaves the event unprocessed when the finalize RPC errors", async () => {
    const db = setup({
      rpc: { record_payment_and_finalize: { error: { message: "booking not found" } } },
    });
    const response = await deliver(succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }));
    expect(response.status).toBe(500);
    expect(processedAt(db)).toBeFalsy(); // so the retry re-drives it
    expect(logged.some((line) => line.includes(EVENT_ID))).toBe(true);
  });

  it("returns 5xx when it cannot record that it finished, so the retry re-drives", async () => {
    const db = setup({
      errors: { "stripe_events.update": { message: "statement timeout", code: "57014" } },
    });
    const response = await deliver(succeeded({ booking_id: BOOKING_ID, payment_kind: "deposit" }));
    expect(response.status).toBe(500);
    expect(finalizeCalls(db)).toHaveLength(1);
  });
});
