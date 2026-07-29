import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTickets, newTicketToken, ticketScanUrl } from "@/lib/tickets";
import { createFakeClient, type FakeClient, type FakeClientOptions, type FakeRow } from "./fake-supabase";

/**
 * The scanner's decision, which is the only thing standing between a refunded
 * student and a coach seat. Covers the outcome precedence, the "already used"
 * count, and the two ticket-identity bugs that made per-ticket redemption unsafe.
 */

const h = vi.hoisted(() => ({ admin: { value: undefined as unknown } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin.value }));

const BOOKING_ID = "44444444-4444-4444-4444-444444444444";
// Deliberately low-entropy and self-describing. A realistic base64url fixture
// trips gitleaks' generic-api-key rule, and the honest fix is a fixture that
// cannot be mistaken for a credential rather than another allowlist entry.
const TOKEN = "test-ticket-token-not-a-real-credential-0001";

function tokenRow(over: FakeRow = {}): FakeRow {
  return {
    token: TOKEN,
    booking_id: BOOKING_ID,
    ticket_id: "TKT-LP-0481",
    ticket_type: "Lift pass",
    title: "6-day lift pass",
    max_scans: 1,
    revoked_at: null,
    bookings: {
      reference: "BRUM-26-0481",
      status: "confirmed",
      users: { first_name: "Sam", last_name: "Okafor" },
      trips: { name: "Brumski Christmas Trip" },
    },
    ...over,
  };
}

function setup(over: FakeClientOptions = {}): FakeClient {
  const db = createFakeClient({
    ...over,
    tables: { ticket_tokens: [tokenRow()], ticket_scans: [], ...over.tables },
  });
  h.admin.value = db;
  return db;
}

async function resolve() {
  const { resolveTicketToken } = await import("@/lib/db/tickets");
  return resolveTicketToken(TOKEN);
}

beforeEach(() => {
  vi.resetModules();
});

describe("resolveTicketToken: the check-in decision", () => {
  it("lets a confirmed student with an unused ticket through", async () => {
    setup();
    const v = await resolve();
    expect(v.outcome).toBe("ok");
    expect(v.ticket?.studentName).toBe("Sam Okafor");
    expect(v.ticket?.reference).toBe("BRUM-26-0481");
  });

  it("refuses a token that does not exist", async () => {
    setup({ tables: { ticket_tokens: [] } });
    const v = await resolve();
    expect(v.outcome).toBe("unknown_token");
    expect(v.ticket).toBeUndefined();
  });

  // The whole reason a signature could never be sufficient: it stays valid for
  // ever, so entitlement has to be read live at scan time.
  it.each(["refunded", "cancelled", "pending", "waitlisted"])(
    "refuses a booking that is %s, however valid the token",
    async (status) => {
      setup({ tables: { ticket_tokens: [tokenRow({ bookings: { ...(tokenRow().bookings as object), status } })] } });
      const v = await resolve();
      expect(v.outcome).toBe("not_entitled");
      expect(v.ticket?.bookingStatus).toBe(status);
    },
  );

  it("accepts a converted (promoted from the waiting list) booking", async () => {
    setup({ tables: { ticket_tokens: [tokenRow({ bookings: { ...(tokenRow().bookings as object), status: "converted" } })] } });
    expect((await resolve()).outcome).toBe("ok");
  });

  it("refuses a revoked ticket even when the booking is fine", async () => {
    setup({ tables: { ticket_tokens: [tokenRow({ revoked_at: "2026-12-01T00:00:00.000Z" })] } });
    expect((await resolve()).outcome).toBe("revoked");
  });

  it("reports a single-use ticket as already used on the second look", async () => {
    setup({
      tables: {
        ticket_scans: [{ token: TOKEN, booking_id: BOOKING_ID, result: "ok", scanned_at: "2026-12-12T09:00:00.000Z" }],
      },
    });
    expect((await resolve()).outcome).toBe("duplicate");
  });

  // A boolean 'used' flag would have stranded every student on the way home.
  it("allows a return coach to be scanned twice but not three times", async () => {
    const coach = tokenRow({ ticket_id: "TKT-CO-00481", ticket_type: "Coach", max_scans: 2 });
    const scan = { token: TOKEN, booking_id: BOOKING_ID, result: "ok", scanned_at: "2026-12-12T07:00:00.000Z" };

    setup({ tables: { ticket_tokens: [coach], ticket_scans: [scan] } });
    expect((await resolve()).outcome).toBe("ok");

    vi.resetModules();
    setup({ tables: { ticket_tokens: [coach], ticket_scans: [scan, { ...scan, scanned_at: "2026-12-19T16:00:00.000Z" }] } });
    expect((await resolve()).outcome).toBe("duplicate");
  });

  it("does not count refused attempts towards the allowance", async () => {
    setup({
      tables: {
        ticket_scans: [
          { token: TOKEN, booking_id: BOOKING_ID, result: "not_entitled", scanned_at: "2026-12-12T08:00:00.000Z" },
          { token: TOKEN, booking_id: BOOKING_ID, result: "duplicate", scanned_at: "2026-12-12T08:01:00.000Z" },
        ],
      },
    });
    // Two rows in the log, neither a successful entry, so the ticket is still good.
    expect((await resolve()).outcome).toBe("ok");
  });

  it("discloses nothing sensitive - a rep sees a name, not a passport", async () => {
    setup();
    const v = await resolve();
    const serialised = JSON.stringify(v);
    for (const field of ["passport", "dob", "access_needs", "policy", "emergency"]) {
      expect(serialised.toLowerCase()).not.toContain(field);
    }
  });
});

describe("ticket identity", () => {
  // Two transport extras previously produced the SAME ticketId, so redeeming one
  // redeemed both - and ticketId is now a uniqueness key, so the collision would
  // have silently dropped a ticket at issuance.
  it("gives every coach ticket a distinct id", () => {
    const t = deriveTickets("BRUM-26-0481", [
      { type: "transport", name: "Return coach" },
      { type: "transport", name: "Airport transfer" },
    ]);
    const ids = t.filter((x) => x.category === "Coach").map((x) => x.ticketId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("gives every ticket on a booking a distinct id", () => {
    const t = deriveTickets("BRUM-26-0481", [
      { type: "transport", name: "Return coach" },
      { type: "transport", name: "Airport transfer" },
      { type: "event", name: "Après night" },
      { type: "event", name: "Comedy night" },
      { type: "equipment", name: "Skis" },
    ]);
    expect(new Set(t.map((x) => x.ticketId)).size).toBe(t.length);
  });

  it("allows a coach two scans and everything else one", () => {
    const t = deriveTickets("BRUM-26-0481", [
      { type: "transport", name: "Return coach" },
      { type: "event", name: "Après night" },
    ]);
    expect(t.find((x) => x.category === "Coach")?.maxScans).toBe(2);
    expect(t.find((x) => x.category === "Lift pass")?.maxScans).toBe(1);
    expect(t.find((x) => x.category === "Event")?.maxScans).toBe(1);
  });

  it("mints unguessable, unique tokens", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => newTicketToken()));
    expect(tokens.size).toBe(500);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url: URL-safe, no escaping
      expect(t.length).toBeGreaterThanOrEqual(40); // 256 bits
    }
  });

  it("puts the token in the path so it survives a sign-in redirect", () => {
    const url = ticketScanUrl("abc123", "https://slush.example/");
    // Not a fragment: a fragment is never sent to the server, so the login
    // round-trip would silently discard it.
    expect(url).toBe("https://slush.example/scan/abc123");
    expect(url).not.toContain("#");
  });
});
