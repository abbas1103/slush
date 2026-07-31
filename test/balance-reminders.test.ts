import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeClient, type FakeRow } from "./fake-supabase";

/**
 * Balance reminders. The properties that matter: each stage fires once, the
 * amount comes from the database rather than being recomputed here, and a
 * booking with no address is skipped rather than crashing the run.
 */

const h = vi.hoisted(() => ({ admin: { value: undefined as unknown } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin.value }));

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";

function detail(id: string, email: string | null): FakeRow {
  return {
    id,
    reference: `BRUM-26-${id.slice(0, 4)}`,
    users: { first_name: "Sam", email },
    trips: { name: "Brumski Christmas Trip", balance_due_date: "2026-11-15" },
  };
}

/** Returns due rows for the 14-day stage only, mirroring exact-day matching. */
function setup(opts: { due14?: FakeRow[]; due3?: FakeRow[]; details?: FakeRow[]; outbox?: FakeRow[] } = {}) {
  let call = 0;
  const db = createFakeClient({
    tables: { bookings: opts.details ?? [], email_outbox: opts.outbox ?? [] },
  });
  const realRpc = db.rpc.bind(db);
  db.rpc = async (name: string, args?: unknown) => {
    if (name === "bookings_due_balance") {
      const days = (args as { p_days: number }).p_days;
      call++;
      return { data: days === 14 ? (opts.due14 ?? []) : (opts.due3 ?? []), error: null };
    }
    return realRpc(name, args);
  };
  h.admin.value = db;
  return { db, stageCalls: () => call };
}

async function run() {
  const { sendBalanceReminders } = await import("@/lib/email/reminders");
  return sendBalanceReminders();
}

beforeEach(() => vi.resetModules());

describe("sendBalanceReminders", () => {
  it("queues nothing when nobody is due", async () => {
    const { db } = setup();
    const r = await run();
    expect(r.due).toBe(0);
    expect(r.queued).toBe(0);
    expect(db.rows("email_outbox")).toHaveLength(0);
  });

  it("queues one reminder per due booking", async () => {
    const { db } = setup({
      due14: [
        { booking_id: B1, balance: 43100, due_date: "2026-11-15" },
        { booking_id: B2, balance: 12000, due_date: "2026-11-15" },
      ],
      details: [detail(B1, "a@example.com"), detail(B2, "b@example.com")],
    });
    const r = await run();
    expect(r.due).toBe(2);
    expect(r.queued).toBe(2);
    expect(db.rows("email_outbox")).toHaveLength(2);
  });

  // The amount a student is told they owe must be the database's number, not
  // one this module worked out for itself.
  it("uses the balance the database returned, untouched", async () => {
    const { db } = setup({
      due14: [{ booking_id: B1, balance: 43100, due_date: "2026-11-15" }],
      details: [detail(B1, "a@example.com")],
    });
    await run();
    const payload = db.rows("email_outbox")[0].payload as { balance: number };
    expect(payload.balance).toBe(43100);
  });

  // The 14-day and 3-day nudges are different messages; a rerun of either is not.
  it("keys the dedupe on the stage, so each fires once but both can fire", async () => {
    const { db } = setup({
      due14: [{ booking_id: B1, balance: 43100, due_date: "2026-11-15" }],
      due3: [{ booking_id: B1, balance: 43100, due_date: "2026-11-15" }],
      details: [detail(B1, "a@example.com")],
    });
    await run();
    const keys = db.rows("email_outbox").map((r) => r.dedupe_key);
    expect(keys).toContain(`balance-reminder:${B1}:14d`);
    expect(keys).toContain(`balance-reminder:${B1}:3d`);

    // Running the same day again must add nothing.
    const before = db.rows("email_outbox").length;
    await run();
    expect(db.rows("email_outbox")).toHaveLength(before);
  });

  it("skips a booking with no address instead of failing the run", async () => {
    const { db } = setup({
      due14: [
        { booking_id: B1, balance: 43100, due_date: "2026-11-15" },
        { booking_id: B2, balance: 12000, due_date: "2026-11-15" },
      ],
      details: [detail(B1, null), detail(B2, "b@example.com")],
    });
    const r = await run();
    expect(r.skipped).toBe(1);
    expect(r.queued).toBe(1);
    expect(db.rows("email_outbox")).toHaveLength(1);
  });
});
