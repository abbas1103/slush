import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeClient, type FakeRow } from "./fake-supabase";
import { renderEmail } from "@/lib/email/templates";

/**
 * Transactional email. The properties worth testing are the ones that cost real
 * money to get wrong: never send a receipt twice, never mark a row sent when
 * nothing was delivered, and never put a float in front of a student.
 */

const h = vi.hoisted(() => ({ admin: { value: undefined as unknown }, send: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin.value }));

function outboxRow(over: FakeRow = {}): FakeRow {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    dedupe_key: "payment:evt_1",
    to_email: "student@example.com",
    template: "payment_receipt",
    payload: { firstName: "Sam", reference: "BRUM-26-0481", amountPaid: 15000, balance: 43100 },
    status: "pending",
    attempts: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  h.send.mockReset();
});

describe("templates", () => {
  it("formats integer pence as pounds, never a float", () => {
    const r = renderEmail("booking_confirmed", {
      firstName: "Sam",
      reference: "BRUM-26-0481",
      tripName: "Brumski",
      amountPaid: 15000,
      damageDeposit: 10000,
      balance: 43100,
    });
    expect(r.text).toContain("£150.00");
    expect(r.text).toContain("£100.00"); // the held deposit
    expect(r.text).toContain("£431.00"); // balance
    expect(r.text).toContain("£50.00"); // 15000 - 10000, the bit that reduces the trip cost
    // A stray pence value leaking through unformatted is the bug to catch.
    expect(r.text).not.toMatch(/\b15000\b|\b43100\b/);
  });

  it("keeps markup out of the plain-text part", () => {
    const r = renderEmail("payment_receipt", { firstName: "Sam", amountPaid: 1000, balance: 0 });
    expect(r.html).toContain("<strong>");
    expect(r.text).not.toContain("<");
  });

  it("tells a fully-paid student their tickets are ready", () => {
    const r = renderEmail("payment_receipt", { amountPaid: 43100, balance: 0 });
    expect(r.subject).toMatch(/Payment received/i);
    expect(r.text).toMatch(/all paid up|tickets are ready/i);
  });

  it("tells a waitlisted student their money is coming back", () => {
    const r = renderEmail("waitlisted", { amountPaid: 15000, reference: "BRUM-26-0002" });
    expect(r.text).toContain("£150.00");
    expect(r.text).toMatch(/refunded/i);
  });

  it("explains a withheld damage deposit differently from a clean one", () => {
    const clean = renderEmail("damage_deposit_refunded", { amountPaid: 10000, damageDeposit: 10000 });
    const partial = renderEmail("damage_deposit_refunded", { amountPaid: 6000, damageDeposit: 10000, withheld: 4000 });
    expect(clean.text).toMatch(/in full/i);
    expect(partial.text).toContain("£40.00");
    expect(partial.text).not.toMatch(/in full/i);
  });
});

describe("enqueue", () => {
  it("does not enqueue without a recipient", async () => {
    const db = createFakeClient({ tables: { email_outbox: [] } });
    h.admin.value = db;
    const { enqueueEmail } = await import("@/lib/email/outbox");
    expect(await enqueueEmail({ dedupeKey: "k", to: "", template: "payment_receipt", payload: {} })).toBe(false);
    expect(db.rows("email_outbox")).toHaveLength(0);
  });

  // Stripe retries a delivery for up to three days. Without this the student
  // gets four identical receipts for one payment.
  it("uses the dedupe key so a webhook retry cannot enqueue twice", async () => {
    const db = createFakeClient({ tables: { email_outbox: [] } });
    h.admin.value = db;
    const { enqueueEmail } = await import("@/lib/email/outbox");
    const args = {
      dedupeKey: "payment:evt_1",
      to: "student@example.com",
      template: "payment_receipt" as const,
      payload: {},
    };
    await enqueueEmail(args);
    await enqueueEmail(args);
    const call = db.calls.find((c) => c.table === "email_outbox");
    expect(call).toBeDefined();
    expect(db.rows("email_outbox").filter((r) => r.dedupe_key === "payment:evt_1")).toHaveLength(1);
  });
});

describe("drain", () => {
  // The exact bug that made the CRM outbox lie about seven rows: an adapter that
  // delivers nothing must never mark anything sent.
  it("leaves rows queued when the adapter delivers nothing", async () => {
    const db = createFakeClient({ tables: { email_outbox: [outboxRow()] } });
    h.admin.value = db;
    vi.stubEnv("EMAIL_PROVIDER", "log");
    const { drainEmailOutbox } = await import("@/lib/email/outbox");
    const r = await drainEmailOutbox();
    expect(r.sent).toBe(0);
    expect(r.queued).toBe(1);
    expect(db.rows("email_outbox")[0].status).toBe("pending");
  });

  it("falls back to inert when EMAIL_PROVIDER=smtp is misconfigured", async () => {
    const db = createFakeClient({ tables: { email_outbox: [outboxRow()] } });
    h.admin.value = db;
    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    vi.stubEnv("SMTP_HOST", "");
    const { drainEmailOutbox } = await import("@/lib/email/outbox");
    const r = await drainEmailOutbox();
    // A missing SMTP password must not throw inside the webhook that records
    // payments, so it degrades rather than failing.
    expect(r.sent).toBe(0);
    expect(db.rows("email_outbox")[0].status).toBe("pending");
  });
});
