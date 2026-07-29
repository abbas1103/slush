import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPaymentIntent, createBalancePaymentIntent } from "@/app/(booking)/book/actions";
import { createFakeClient, type FakeClient, type FakeClientOptions, type FakeRow } from "./fake-supabase";

/**
 * The amount that reaches Stripe, and the guard that stops a booking holding two
 * chargeable intents. Both are money decisions taken entirely server-side, so
 * they are tested through the real server actions with the database, Stripe and
 * the rate limiter stubbed at the module boundary - the arithmetic, the clamp,
 * the ownership check and the intent state machine are all the real code.
 */

const h = vi.hoisted(() => ({
  admin: { value: undefined as unknown },
  server: { value: undefined as unknown },
  allowed: { value: true },
  create: vi.fn<
    (
      params: { amount: number; currency: string; metadata: Record<string, string> },
      options?: { idempotencyKey?: string },
    ) => Promise<unknown>
  >(),
  retrieve: vi.fn<(id: string) => Promise<unknown>>(),
  cancel: vi.fn<(id: string) => Promise<unknown>>(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin.value }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => Promise.resolve(h.server.value) }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: () => Promise.resolve(h.allowed.value),
  clientIp: () => Promise.resolve("203.0.113.9"),
}));
vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    paymentIntents: { create: h.create, retrieve: h.retrieve, cancel: h.cancel },
  },
}));

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const TRIP_ID = "33333333-3333-3333-3333-333333333333";
const BOOKING_ID = "44444444-4444-4444-4444-444444444444";

// The Brumski trip: £439 place, £150 deposit = £50 down + £100 damage.
const trip: FakeRow = {
  id: TRIP_ID,
  base_price: 43900,
  deposit_amount: 15000,
  downpayment_amount: 5000,
  damage_deposit_amount: 10000,
};

function booking(overrides: FakeRow = {}): FakeRow {
  return {
    id: BOOKING_ID,
    user_id: USER_ID,
    trip_id: TRIP_ID,
    status: "pending",
    reference: "BRUM-26-0481",
    payment_intent_id: null,
    base_price_at_booking: null,
    // Set by saveDetails. createPaymentIntent refuses to mint an intent without
    // it plus a consents row, so the default fixture is a booking that HAS
    // completed the details step (audit #39).
    insurance_choice: "own",
    ...overrides,
  };
}

function setup(overrides: FakeClientOptions = {}): FakeClient {
  const db = createFakeClient({
    user: { id: USER_ID, email_confirmed_at: "2026-07-01T09:00:00.000Z" },
    ...overrides,
    tables: {
      bookings: [booking()],
      trips: [trip],
      booking_extras: [],
      payments: [],
      // saveDetails is the sole writer of this row; without it the details gate
      // in createPaymentIntent refuses to charge.
      consents: [{ id: "consent-1", booking_id: BOOKING_ID, user_id: USER_ID }],
      ...overrides.tables,
    },
  });
  h.admin.value = db;
  h.server.value = db;
  return db;
}

/** The amount and idempotency key the action asked Stripe to charge. */
function created(): { amount: number; metadata: Record<string, string>; key?: string } {
  expect(h.create).toHaveBeenCalledTimes(1);
  const [params, options] = h.create.mock.calls[0];
  return { amount: params.amount, metadata: params.metadata, key: options?.idempotencyKey };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.allowed.value = true;
  h.create.mockImplementation((params) =>
    Promise.resolve({
      id: "pi_new",
      client_secret: "cs_new",
      amount: params.amount,
      status: "requires_payment_method",
    }),
  );
  h.retrieve.mockRejectedValue(new Error("paymentIntents.retrieve was not stubbed"));
  h.cancel.mockResolvedValue({ id: "pi_live", status: "canceled" });
});

describe("createPaymentIntent: the amount is recomputed from the database", () => {
  it("charges the £150 deposit, not the trip cost", async () => {
    const db = setup();
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result).toEqual({ ok: true, clientSecret: "cs_new", amount: 15000 });
    expect(created().amount).toBe(15000);
    expect(created().metadata).toEqual({
      booking_id: BOOKING_ID,
      trip_id: TRIP_ID,
      payment_kind: "deposit",
      reference: "BRUM-26-0481",
    });
    // The live intent is recorded, so a second call cannot mint another one.
    expect(db.rows("bookings")[0].payment_intent_id).toBe("pi_new");
  });

  it("charges trip cost + £100 for pay in full, extras included", async () => {
    setup({
      tables: {
        booking_extras: [
          { booking_id: BOOKING_ID, price_at_booking: 23900, quantity: 1 }, // coach
          { booking_id: BOOKING_ID, price_at_booking: 4200, quantity: 1 }, // cover
        ],
      },
    });
    const result = await createPaymentIntent(BOOKING_ID, "full");
    expect(result).toEqual({ ok: true, clientSecret: "cs_new", amount: 82000 });
    expect(created().amount).toBe(82000); // 43900 + 23900 + 4200 + 10000
  });

  it("multiplies a quantity rather than charging it once", async () => {
    setup({
      tables: { booking_extras: [{ booking_id: BOOKING_ID, price_at_booking: 4200, quantity: 2 }] },
    });
    await createPaymentIntent(BOOKING_ID, "full");
    expect(created().amount).toBe(62300); // 43900 + 8400 + 10000
  });

  it("ignores extras that belong to another booking", async () => {
    setup({
      tables: {
        booking_extras: [
          { booking_id: "99999999-9999-9999-9999-999999999999", price_at_booking: 23900, quantity: 1 },
        ],
      },
    });
    await createPaymentIntent(BOOKING_ID, "full");
    expect(created().amount).toBe(53900); // 43900 + 10000, the other booking's coach excluded
  });

  it("prices from the base price snapshotted on the booking, not the trip's current one", async () => {
    // An admin raising trips.base_price must not reprice a booking already taken.
    setup({ tables: { bookings: [booking({ base_price_at_booking: 39900 })] } });
    await createPaymentIntent(BOOKING_ID, "full");
    expect(created().amount).toBe(49900); // 39900 + 10000, not 53900
  });

  it("refuses a payment mode the client made up", async () => {
    setup();
    const result = await createPaymentIntent(BOOKING_ID, "topup" as unknown as "deposit");
    expect(result.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses someone else's booking", async () => {
    setup({ tables: { bookings: [booking({ user_id: OTHER_USER_ID })] } });
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result).toEqual({ ok: false, error: "Booking not found." });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses a booking that is no longer pending", async () => {
    setup({ tables: { bookings: [booking({ status: "confirmed" })] } });
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses when the booking read fails, rather than pricing from nothing", async () => {
    setup({ errors: { "bookings.select": { message: "statement timeout", code: "57014" } } });
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses when the extras read fails, rather than charging a base-price-only total", async () => {
    setup({
      tables: { booking_extras: [{ booking_id: BOOKING_ID, price_at_booking: 23900, quantity: 1 }] },
      errors: { "booking_extras.select": { message: "statement timeout", code: "57014" } },
    });
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses an unverified email and an anonymous caller", async () => {
    setup({ user: { id: USER_ID, email_confirmed_at: null } });
    expect((await createPaymentIntent(BOOKING_ID, "deposit")).ok).toBe(false);
    setup({ user: null });
    expect((await createPaymentIntent(BOOKING_ID, "deposit")).ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses once the rate limiter says no (denial of wallet)", async () => {
    setup();
    h.allowed.value = false;
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("createPaymentIntent: one live intent per booking", () => {
  it("reuses the recorded intent for the same amount instead of minting a second", async () => {
    setup({ tables: { bookings: [booking({ payment_intent_id: "pi_live" })] } });
    h.retrieve.mockResolvedValue({
      id: "pi_live",
      status: "requires_payment_method",
      amount: 15000,
      client_secret: "cs_live",
    });
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result).toEqual({ ok: true, clientSecret: "cs_live", amount: 15000 });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("cancels the old intent before minting one for a different amount", async () => {
    setup({ tables: { bookings: [booking({ payment_intent_id: "pi_live" })] } });
    h.retrieve.mockResolvedValue({
      id: "pi_live",
      status: "requires_payment_method",
      amount: 15000,
      client_secret: "cs_live",
    });
    const result = await createPaymentIntent(BOOKING_ID, "full");
    expect(result.ok).toBe(true);
    expect(h.cancel).toHaveBeenCalledWith("pi_live");
    expect(created().amount).toBe(53900);
  });

  it("refuses if the old intent cannot be cancelled, so two are never live", async () => {
    setup({ tables: { bookings: [booking({ payment_intent_id: "pi_live" })] } });
    h.retrieve.mockResolvedValue({
      id: "pi_live",
      status: "requires_payment_method",
      amount: 15000,
      client_secret: "cs_live",
    });
    h.cancel.mockRejectedValue(new Error("Stripe is down"));
    const result = await createPaymentIntent(BOOKING_ID, "full");
    expect(result.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses while a charge is already processing", async () => {
    setup({ tables: { bookings: [booking({ payment_intent_id: "pi_live" })] } });
    h.retrieve.mockResolvedValue({ id: "pi_live", status: "processing", amount: 15000 });
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("refuses while a settled payment is not yet in the ledger", async () => {
    setup({ tables: { bookings: [booking({ payment_intent_id: "pi_live" })], payments: [] } });
    h.retrieve.mockResolvedValue({ id: "pi_live", status: "succeeded", amount: 15000 });
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result.ok).toBe(false); // pricing a new intent now would ignore money taken
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses when the recorded intent cannot be read at all", async () => {
    setup({ tables: { bookings: [booking({ payment_intent_id: "pi_live" })] } });
    h.retrieve.mockRejectedValue(new Error("network"));
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result.ok).toBe(false); // an unreadable intent might still be payable
    expect(h.create).not.toHaveBeenCalled();
  });

  it("mints a fresh intent when Stripe has no such intent", async () => {
    setup({ tables: { bookings: [booking({ payment_intent_id: "pi_stale" })] } });
    h.retrieve.mockRejectedValue({ code: "resource_missing", message: "No such payment_intent" });
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result.ok).toBe(true);
    expect(created().amount).toBe(15000);
  });

  it("cancels its own new intent if the live-intent slot cannot be recorded", async () => {
    // audit #13: an untracked live intent is invisible to the double-charge
    // guard, so its client secret must never reach the browser.
    setup({ errors: { "bookings.update": { message: "deadlock detected", code: "40P01" } } });
    const result = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(result.ok).toBe(false);
    expect(h.cancel).toHaveBeenCalledWith("pi_new");
  });

  it("uses a different idempotency key for a different amount", async () => {
    setup();
    await createPaymentIntent(BOOKING_ID, "deposit");
    const depositKey = created().key;
    expect(typeof depositKey).toBe("string");
    expect(depositKey).not.toBe("");

    h.create.mockClear();
    setup();
    await createPaymentIntent(BOOKING_ID, "full");
    expect(created().key).not.toBe(depositKey);
  });

  // Regression: the key used to be composed from
  // `pi:<booking>:<kind>:<amount>:<recordedIntentId ?? "new">`. The deposit
  // amount is a flat trip field and clearLiveIntent resets payment_intent_id to
  // null, so a student who edited their extras after opening the pay screen
  // produced a byte-identical key on the next mint. Stripe then REPLAYED the
  // create and handed back the intent it had just cancelled, whose client
  // secret cannot be confirmed. Two mints in the same state must not collide.
  it("does not reuse an idempotency key across two mints in the same state", async () => {
    setup();
    await createPaymentIntent(BOOKING_ID, "deposit");
    const first = created().key;

    h.create.mockClear();
    setup(); // slot cleared again: same booking, same kind, same amount
    await createPaymentIntent(BOOKING_ID, "deposit");
    const second = created().key;

    expect(first).not.toBe(second);
  });

  it("refuses to charge a booking that has not completed the details step", async () => {
    // No consents row: saveDetails never ran, so no terms were accepted, no
    // passport/DOB captured and the 18+ gate never applied (audit #39/#7).
    setup({ tables: { consents: [] } });
    const r = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(r.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses to charge when the insurance declaration is missing", async () => {
    setup({ tables: { bookings: [booking({ insurance_choice: null })] } });
    const r = await createPaymentIntent(BOOKING_ID, "deposit");
    expect(r.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("createBalancePaymentIntent: never more than is owed", () => {
  function confirmed(overrides: FakeClientOptions = {}): FakeClient {
    return setup({
      ...overrides,
      tables: { bookings: [booking({ status: "confirmed" })], ...overrides.tables },
      rpc: { booking_balance: { data: 38900 }, ...overrides.rpc },
    });
  }

  it("asks the database for the balance instead of summing the ledger itself", async () => {
    // booking_balance() is the one implementation that also subtracts the
    // trip-applied part of a waitlist refund; a hand-rolled sum of deposit +
    // balance rows in TypeScript misses it and chases a refunded student for
    // money. The rpc assertion is the guard: the action must ask the database,
    // not read these rows and add them up.
    const db = confirmed({
      tables: {
        payments: [
          { booking_id: BOOKING_ID, type: "deposit", amount: 5000, status: "succeeded" },
          { booking_id: BOOKING_ID, type: "waitlist_refund", amount: 15000, status: "succeeded" },
        ],
      },
    });
    const result = await createBalancePaymentIntent(BOOKING_ID, 38900);
    expect(result.ok).toBe(true);
    expect(created().amount).toBe(38900);
    expect(db.rpcCalls).toEqual([{ name: "booking_balance", args: { p_booking_id: BOOKING_ID } }]);
  });

  it("clamps an overpayment down to the balance", async () => {
    confirmed();
    const result = await createBalancePaymentIntent(BOOKING_ID, 100000);
    expect(result).toEqual({ ok: true, clientSecret: "cs_new", amount: 38900 });
    expect(created().amount).toBe(38900);
  });

  it("charges a part payment as asked", async () => {
    confirmed();
    await createBalancePaymentIntent(BOOKING_ID, 20000);
    expect(created().amount).toBe(20000);
  });

  it("rounds fractional pence to a whole number of pence", async () => {
    confirmed();
    await createBalancePaymentIntent(BOOKING_ID, 20000.6);
    expect(created().amount).toBe(20001);
    expect(Number.isInteger(created().amount)).toBe(true);
  });

  it("refuses a cleared balance and an overpaid one", async () => {
    confirmed({ rpc: { booking_balance: { data: 0 } } });
    expect((await createBalancePaymentIntent(BOOKING_ID, 5000)).ok).toBe(false);
    confirmed({ rpc: { booking_balance: { data: -5000 } } });
    expect((await createBalancePaymentIntent(BOOKING_ID, 5000)).ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses amounts that are not a positive whole number of pence", async () => {
    for (const requested of [0, -1, -100000, Number.NaN, Number.POSITIVE_INFINITY, 1e21]) {
      confirmed();
      const result = await createBalancePaymentIntent(BOOKING_ID, requested);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/valid amount/i);
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses below Stripe's £0.30 minimum", async () => {
    confirmed();
    const result = await createBalancePaymentIntent(BOOKING_ID, 29);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/minimum/i);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rounds a fraction of a penny up into a sub-minimum amount and still refuses", async () => {
    confirmed();
    const result = await createBalancePaymentIntent(BOOKING_ID, 0.5);
    expect(result.ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("says so when the remaining balance itself is under £0.30", async () => {
    confirmed({ rpc: { booking_balance: { data: 20 } } });
    const result = await createBalancePaymentIntent(BOOKING_ID, 20000);
    expect(result.ok).toBe(false);
    // The clamp brought it to 20p; the student needs telling, not a "minimum" error.
    if (!result.ok) expect(result.error).toMatch(/under/i);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("charges a balance of exactly £0.30", async () => {
    confirmed({ rpc: { booking_balance: { data: 30 } } });
    const result = await createBalancePaymentIntent(BOOKING_ID, 30);
    expect(result.ok).toBe(true);
    expect(created().amount).toBe(30);
  });

  it("refuses when the balance cannot be read, rather than treating it as unpaid", async () => {
    // audit #40: a failed read must never mean "you have paid nothing".
    confirmed({ rpc: { booking_balance: { error: { message: "statement timeout", code: "57014" } } } });
    expect((await createBalancePaymentIntent(BOOKING_ID, 20000)).ok).toBe(false);
    confirmed({ rpc: { booking_balance: { data: null } } });
    expect((await createBalancePaymentIntent(BOOKING_ID, 20000)).ok).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("opens only once the place is confirmed", async () => {
    for (const status of ["pending", "waitlisted", "cancelled", "refunded"]) {
      const db = setup({
        tables: { bookings: [booking({ status })] },
        rpc: { booking_balance: { data: 38900 } },
      });
      const result = await createBalancePaymentIntent(BOOKING_ID, 20000);
      expect(result.ok).toBe(false);
      expect(db.rpcCalls).toEqual([]); // rejected before any balance is worked out
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses someone else's booking", async () => {
    confirmed({ tables: { bookings: [booking({ status: "confirmed", user_id: OTHER_USER_ID })] } });
    const result = await createBalancePaymentIntent(BOOKING_ID, 20000);
    expect(result).toEqual({ ok: false, error: "Booking not found." });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("marks the balance intent as a balance payment for the ledger", async () => {
    confirmed();
    await createBalancePaymentIntent(BOOKING_ID, 20000);
    expect(created().metadata.payment_kind).toBe("balance");
    expect(created().metadata.booking_id).toBe(BOOKING_ID);
  });

  it("frees the slot for a further top-up once the settled payment is in the ledger", async () => {
    confirmed({
      tables: {
        bookings: [booking({ status: "confirmed", payment_intent_id: "pi_settled" })],
        payments: [
          {
            booking_id: BOOKING_ID,
            type: "balance",
            amount: 20000,
            status: "succeeded",
            stripe_payment_intent_id: "pi_settled",
          },
        ],
      },
    });
    h.retrieve.mockResolvedValue({ id: "pi_settled", status: "succeeded", amount: 20000 });
    const result = await createBalancePaymentIntent(BOOKING_ID, 18900);
    expect(result.ok).toBe(true);
    expect(created().amount).toBe(18900);
  });
});
