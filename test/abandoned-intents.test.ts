import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeClient, type FakeRow } from "./fake-supabase";

/**
 * The abandoned-intent sweep. Everything here is a safety property: this is the
 * only code that cancels a PaymentIntent without a human asking it to, so the
 * tests that matter are the ones proving what it REFUSES to touch.
 */

const h = vi.hoisted(() => ({
  admin: { value: undefined as unknown },
  retrieve: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin.value }));
vi.mock("@/lib/stripe/server", () => ({
  stripe: { paymentIntents: { retrieve: h.retrieve, cancel: h.cancel } },
}));

const BOOKING = "55555555-5555-5555-5555-555555555555";
const PI = "pi_abandoned";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

function booking(over: FakeRow = {}): FakeRow {
  return {
    id: BOOKING,
    status: "pending",
    payment_intent_id: PI,
    // Hold lapsed well past the 60-minute grace period.
    holds: [{ status: "expired", expires_at: ago(120) }],
    payments: [],
    ...over,
  };
}

function setup(rows: FakeRow[]) {
  const db = createFakeClient({ tables: { bookings: rows } });
  h.admin.value = db;
  return db;
}

async function sweep() {
  const { sweepAbandonedIntents } = await import("@/lib/booking/abandoned");
  return sweepAbandonedIntents();
}

beforeEach(() => {
  vi.resetModules();
  h.retrieve.mockReset();
  h.cancel.mockReset();
});

describe("what it refuses to touch", () => {
  // The whole point. Cancelling here races the webhook that writes the ledger.
  it.each(["processing", "succeeded", "requires_capture"])(
    "never cancels an intent that is %s",
    async (status) => {
      setup([booking()]);
      h.retrieve.mockResolvedValue({ id: PI, status });
      const r = await sweep();
      expect(h.cancel).not.toHaveBeenCalled();
      expect(r.skipped).toBe(1);
      expect(r.cancelled).toBe(0);
    },
  );

  it("leaves a booking whose payment already succeeded", async () => {
    setup([booking({ payments: [{ status: "succeeded" }] })]);
    await sweep();
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("leaves a booking that still holds a place", async () => {
    setup([booking({ holds: [{ status: "active", expires_at: ahead(10) }] })]);
    const r = await sweep();
    expect(h.cancel).not.toHaveBeenCalled();
    expect(r.considered).toBe(0);
  });

  // A student can be sitting on the payment page as the hold lapses. The grace
  // period is what stops the sweep cancelling an intent they are about to pay.
  it("leaves a hold that lapsed inside the grace period", async () => {
    setup([booking({ holds: [{ status: "expired", expires_at: ago(5) }] })]);
    const r = await sweep();
    expect(h.cancel).not.toHaveBeenCalled();
    expect(r.considered).toBe(0);
  });
});

describe("what it resolves", () => {
  it.each(["requires_payment_method", "requires_confirmation", "requires_action"])(
    "cancels a %s intent and clears the column",
    async (status) => {
      const db = setup([booking()]);
      h.retrieve.mockResolvedValue({ id: PI, status });
      h.cancel.mockResolvedValue({ id: PI, status: "canceled" });

      const r = await sweep();
      expect(h.cancel).toHaveBeenCalledWith(PI);
      expect(r.cancelled).toBe(1);
      expect(db.rows("bookings")[0].payment_intent_id).toBeNull();
      // Deliberately does NOT set status: expire_stale_holds owns that
      // transition, and two owners of one rule eventually disagree.
      expect(db.rows("bookings")[0].status).toBe("pending");
    },
  );

  it("clears the column for an already-canceled intent without calling cancel", async () => {
    const db = setup([booking()]);
    h.retrieve.mockResolvedValue({ id: PI, status: "canceled" });

    const r = await sweep();
    expect(h.cancel).not.toHaveBeenCalled();
    expect(r.cleared).toBe(1);
    expect(db.rows("bookings")[0].payment_intent_id).toBeNull();
  });

  it("counts a Stripe failure without aborting the run", async () => {
    setup([booking()]);
    h.retrieve.mockRejectedValue(new Error("stripe down"));
    const r = await sweep();
    expect(r.failed).toBe(1);
    expect(r.cancelled).toBe(0);
  });
});
