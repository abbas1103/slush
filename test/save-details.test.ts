import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { saveDetails } from "@/app/(booking)/book/actions";
import { decryptPII } from "@/lib/crypto/pii";
import type { DetailsInput } from "@/lib/validation/details";
import { createFakeClient, type FakeCall, type FakeClient, type FakeClientOptions, type FakeRow } from "./fake-supabase";
import { TERMS_VERSION } from "@/lib/legal/version";

/**
 * saveDetails is the 18+ gate and the only writer of student PII, so this covers
 * both: who is allowed on the trip (including the exactly-18-on-arrival
 * boundary), and that nothing sensitive is written in the clear. It also covers
 * the "reported success but wrote nothing" class of bug - every write here is a
 * legal record (declarations) or a safety one (emergency contact).
 */

const h = vi.hoisted(() => ({
  admin: { value: undefined as unknown },
  server: { value: undefined as unknown },
  allowed: { value: true },
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin.value }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => Promise.resolve(h.server.value) }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: () => Promise.resolve(h.allowed.value),
  clientIp: () => Promise.resolve("203.0.113.9"),
}));
vi.mock("@/lib/stripe/server", () => ({
  stripe: { paymentIntents: { create: vi.fn(), retrieve: vi.fn(), cancel: vi.fn() } },
  stripeWebhookSecret: "whsec_test_not_used_here",
}));

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const TRIP_ID = "33333333-3333-3333-3333-333333333333";
const BOOKING_ID = "44444444-4444-4444-4444-444444444444";
const COVER_ID = "55555555-5555-5555-5555-555555555555";
const TRIP_START = "2026-12-12";
const AGE_ERROR = "You must be 18 or over on arrival in resort.";

const originalKey = process.env.PII_ENCRYPTION_KEY;

const details: DetailsInput = {
  title: "Mr",
  firstName: "Sam",
  lastName: "Okafor",
  dob: "2001-03-12",
  nationality: "British",
  passportNumber: "X1234567",
  phone: "+44 7700 900123",
  emergencyName: "Ada Okafor",
  emergencyPhone: "+44 7700 900456",
  marketingOptIn: false,
  insuranceChoice: "own",
  insurer: "Acme Travel",
  policyNumber: "AC-99201",
  shareAccessNeeds: false,
  declAge: true,
  declFit: true,
  declTerms: true,
};

function input(overrides: Partial<DetailsInput> = {}): DetailsInput {
  return { ...details, ...overrides };
}

function setup(overrides: FakeClientOptions = {}, startDate = TRIP_START): FakeClient {
  const db = createFakeClient({
    user: { id: USER_ID, email_confirmed_at: "2026-07-01T09:00:00.000Z" },
    ...overrides,
    tables: {
      bookings: [
        {
          id: BOOKING_ID,
          user_id: USER_ID,
          trip_id: TRIP_ID,
          status: "pending",
          payment_intent_id: null,
        },
      ],
      trips: [{ id: TRIP_ID, start_date: startDate }],
      users: [{ id: USER_ID }],
      extras: [],
      booking_extras: [],
      emergency_contacts: [],
      consents: [],
      ...overrides.tables,
    },
  });
  h.admin.value = db;
  h.server.value = db;
  return db;
}

function writes(db: FakeClient): FakeCall[] {
  return db.calls.filter((call) => call.operation !== "select");
}

function payloadFor(db: FakeClient, table: string, operation: FakeCall["operation"]): FakeRow {
  const call = db.calls.find((c) => c.table === table && c.operation === operation);
  if (!call) throw new Error(`no ${operation} on ${table} was made`);
  return call.payload as FakeRow;
}

beforeEach(() => {
  vi.restoreAllMocks();
  h.allowed.value = true;
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = originalKey;
});

describe("saveDetails: 18 or over on arrival in resort", () => {
  it("accepts someone who turns 18 on the day the trip starts", async () => {
    const db = setup();
    const result = await saveDetails(BOOKING_ID, input({ dob: "2008-12-12" }));
    expect(result).toEqual({ ok: true });
    expect(writes(db).length).toBeGreaterThan(0);
  });

  it("refuses someone who turns 18 the day after arrival, and writes nothing", async () => {
    const db = setup();
    const result = await saveDetails(BOOKING_ID, input({ dob: "2008-12-13" }));
    expect(result).toEqual({ ok: false, error: AGE_ERROR });
    expect(writes(db)).toEqual([]);
  });

  it("refuses someone whose birthday falls after the trip that year", async () => {
    const db = setup();
    const result = await saveDetails(BOOKING_ID, input({ dob: "2009-01-05" }));
    expect(result).toEqual({ ok: false, error: AGE_ERROR });
    expect(writes(db)).toEqual([]);
  });

  it("handles a 29 February birthday on both sides of the boundary", async () => {
    // Born 29 Feb 2008. In 2026 there is no 29 February, so they are not 18
    // until 1 March.
    const before = setup({}, "2026-02-28");
    expect(await saveDetails(BOOKING_ID, input({ dob: "2008-02-29" }))).toEqual({
      ok: false,
      error: AGE_ERROR,
    });
    expect(writes(before)).toEqual([]);

    setup({}, "2026-03-01");
    expect(await saveDetails(BOOKING_ID, input({ dob: "2008-02-29" }))).toEqual({ ok: true });
  });

  it("refuses a date of birth in the future", async () => {
    const db = setup();
    const result = await saveDetails(BOOKING_ID, input({ dob: "2030-01-01" }));
    expect(result).toEqual({ ok: false, error: AGE_ERROR });
    expect(writes(db)).toEqual([]);
  });

  it("refuses a calendar-impossible date of birth before it can reach the age maths", async () => {
    // The gate's own NaN guard is the backstop; the schema is what stops
    // 2011-02-30 becoming an Invalid Date whose age comparison is always false.
    const db = setup();
    const result = await saveDetails(BOOKING_ID, input({ dob: "2011-02-30" }));
    expect(result.ok).toBe(false);
    expect(writes(db)).toEqual([]);
  });

  it("refuses without the three declarations", async () => {
    const db = setup();
    const result = await saveDetails(BOOKING_ID, input({ declTerms: false }));
    expect(result.ok).toBe(false);
    expect(writes(db)).toEqual([]);
  });
});

describe("saveDetails: PII is never written in the clear", () => {
  it("stores the passport number, DOB and phone as recoverable ciphertext", async () => {
    const db = setup();
    expect(await saveDetails(BOOKING_ID, input())).toEqual({ ok: true });

    const profile = payloadFor(db, "users", "update");
    for (const [column, plaintext] of [
      ["dob", "2001-03-12"],
      ["passport_number", "X1234567"],
      ["phone", "+44 7700 900123"],
    ] as const) {
      expect(profile[column]).toMatch(/^v1:/);
      expect(profile[column]).not.toContain(plaintext);
      expect(decryptPII(String(profile[column]))).toBe(plaintext);
    }
    // The name is not encrypted (admins read the manifest), so this is the line
    // between what is protected and what is not.
    expect(profile.first_name).toBe("Sam");
  });

  it("stores the emergency contact encrypted, name and number both", async () => {
    const db = setup();
    await saveDetails(BOOKING_ID, input());
    const contact = payloadFor(db, "emergency_contacts", "insert");
    expect(decryptPII(String(contact.full_name))).toBe("Ada Okafor");
    expect(decryptPII(String(contact.phone))).toBe("+44 7700 900456");
  });

  it("encrypts the insurance policy number and the access needs", async () => {
    const db = setup();
    await saveDetails(
      BOOKING_ID,
      input({ accessNeeds: "Type 1 diabetic - fridge for insulin", shareAccessNeeds: true }),
    );
    const bookingUpdate = payloadFor(db, "bookings", "update");
    expect(decryptPII(String(bookingUpdate.access_needs))).toBe(
      "Type 1 diabetic - fridge for insulin",
    );
    const insurance = bookingUpdate.insurance_details as { insurer: string; policy: string };
    expect(insurance.insurer).toBe("Acme Travel"); // not sensitive
    expect(decryptPII(insurance.policy)).toBe("AC-99201");
  });

  it("leaves no sensitive value anywhere in what it sends to the database", async () => {
    const db = setup();
    await saveDetails(BOOKING_ID, input({ accessNeeds: "Nut allergy" }));
    const everythingWritten = JSON.stringify(writes(db));
    for (const secret of [
      "X1234567",
      "2001-03-12",
      "+44 7700 900123",
      "+44 7700 900456",
      "Ada Okafor",
      "AC-99201",
      "Nut allergy",
    ]) {
      expect(everythingWritten).not.toContain(secret);
    }
  });

  it("stores null rather than ciphertext when there are no access needs", async () => {
    const db = setup();
    await saveDetails(BOOKING_ID, input({ accessNeeds: "" }));
    expect(payloadFor(db, "bookings", "update").access_needs).toBeNull();
    expect(payloadFor(db, "consents", "insert").health_data_consent).toBe(false);
  });
});

describe("saveDetails: the record of what was agreed", () => {
  it("records the declarations against a terms version, with timestamps", async () => {
    const db = setup();
    await saveDetails(BOOKING_ID, input({ marketingOptIn: true, shareAccessNeeds: true }));
    const consent = payloadFor(db, "consents", "insert");
    expect(consent.booking_id).toBe(BOOKING_ID);
    expect(consent.user_id).toBe(USER_ID);
    // Must be the identifier the /terms page displays, not a literal. These
    // drifted before: the page said terms-2026-07-29-draft while consent rows
    // recorded "v1", naming a version that had never existed.
    expect(consent.terms_version).toBe(TERMS_VERSION);
    expect(consent.terms_version).not.toBe("v1");
    expect(typeof consent.terms_accepted_at).toBe("string");
    expect(consent.marketing_opt_in).toBe(true);
    expect(typeof consent.marketing_opt_in_at).toBe("string");
    expect(consent.share_access_needs_with_resort).toBe(true);
  });

  it("does not date a marketing opt-in that was never given", async () => {
    const db = setup();
    await saveDetails(BOOKING_ID, input({ marketingOptIn: false }));
    const consent = payloadFor(db, "consents", "insert");
    expect(consent.marketing_opt_in).toBe(false);
    expect(consent.marketing_opt_in_at).toBeNull();
  });

  it("replaces the consent record instead of stacking a second one", async () => {
    const db = setup({ tables: { consents: [{ booking_id: BOOKING_ID, terms_version: "v1" }] } });
    await saveDetails(BOOKING_ID, input());
    expect(db.rows("consents")).toHaveLength(1);
  });
});

describe("saveDetails: the insurance cover extra is priced from the catalogue", () => {
  const cover: FakeRow = {
    id: COVER_ID,
    trip_id: TRIP_ID,
    type: "other",
    active: true,
    price: 4200,
    sort_order: 1,
  };

  it("adds the cover at the catalogue price when the student buys it", async () => {
    const db = setup({ tables: { extras: [cover] } });
    expect(await saveDetails(BOOKING_ID, input({ insuranceChoice: "bought" }))).toEqual({ ok: true });
    const added = payloadFor(db, "booking_extras", "insert");
    expect(added).toEqual({
      booking_id: BOOKING_ID,
      extra_id: COVER_ID,
      quantity: 1,
      price_at_booking: 4200, // £42, taken from the extras row, never from the client
    });
  });

  it("removes the cover when the student switches to their own policy", async () => {
    const db = setup({
      tables: {
        extras: [cover],
        booking_extras: [{ id: "be_1", booking_id: BOOKING_ID, extra_id: COVER_ID }],
      },
    });
    expect(await saveDetails(BOOKING_ID, input({ insuranceChoice: "own" }))).toEqual({ ok: true });
    expect(db.rows("booking_extras")).toHaveLength(0);
  });

  it("refuses to guess when the trip has two active 'other' extras", async () => {
    const db = setup({
      tables: {
        extras: [cover, { ...cover, id: "66666666-6666-6666-6666-666666666666", sort_order: 2 }],
      },
    });
    const result = await saveDetails(BOOKING_ID, input({ insuranceChoice: "bought" }));
    expect(result.ok).toBe(false); // selling a hoodie as insurance is worse than failing
    expect(writes(db)).toEqual([]);
  });
});

describe("saveDetails: a failed write is never reported as success", () => {
  it("fails when the profile cannot be saved", async () => {
    const db = setup({ errors: { "users.update": { message: "permission denied", code: "42501" } } });
    const result = await saveDetails(BOOKING_ID, input());
    expect(result.ok).toBe(false);
    expect(db.calls.some((call) => call.table === "consents")).toBe(false);
  });

  it("fails when the emergency contact cannot be written", async () => {
    const db = setup({
      errors: { "emergency_contacts.insert": { message: "null value in column", code: "23502" } },
    });
    const result = await saveDetails(BOOKING_ID, input());
    expect(result.ok).toBe(false); // a student with no next of kin must not pass
    expect(db.rows("emergency_contacts")).toHaveLength(0);
  });

  it("fails when the declarations cannot be recorded", async () => {
    setup({ errors: { "consents.insert": { message: "deadlock detected", code: "40P01" } } });
    const result = await saveDetails(BOOKING_ID, input());
    expect(result.ok).toBe(false);
  });

  it("fails when the booking cannot be read at all", async () => {
    const db = setup({ errors: { "bookings.select": { message: "statement timeout", code: "57014" } } });
    const result = await saveDetails(BOOKING_ID, input());
    expect(result.ok).toBe(false);
    expect(writes(db)).toEqual([]);
  });
});

describe("saveDetails: only the owner, only while pending", () => {
  it("refuses someone else's booking", async () => {
    const db = setup({
      tables: {
        bookings: [
          {
            id: BOOKING_ID,
            user_id: OTHER_USER_ID,
            trip_id: TRIP_ID,
            status: "pending",
            payment_intent_id: null,
          },
        ],
      },
    });
    const result = await saveDetails(BOOKING_ID, input());
    expect(result).toEqual({ ok: false, error: "Booking not found." });
    expect(writes(db)).toEqual([]);
  });

  it("refuses once the booking is no longer pending", async () => {
    const db = setup({
      tables: {
        bookings: [
          {
            id: BOOKING_ID,
            user_id: USER_ID,
            trip_id: TRIP_ID,
            status: "confirmed",
            payment_intent_id: null,
          },
        ],
      },
    });
    const result = await saveDetails(BOOKING_ID, input());
    expect(result.ok).toBe(false);
    expect(writes(db)).toEqual([]);
  });

  it("refuses an anonymous caller", async () => {
    const db = setup({ user: null });
    const result = await saveDetails(BOOKING_ID, input());
    expect(result.ok).toBe(false);
    expect(db.calls).toEqual([]);
  });
});
