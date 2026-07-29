import { describe, it, expect } from "vitest";
import { detailsSchema, type DetailsInput } from "./details";

/**
 * The details step is where student PII enters the system, so this is the
 * boundary that has to hold: no unknown keys (mass assignment), no
 * calendar-impossible date of birth (which would let the server's 18+ gate see
 * NaN and wave it through - audit #4), and no booking without the three
 * declarations. Everything asserted here is the schema's own contract; the age
 * arithmetic itself needs the trip's start date and lives in saveDetails.
 */
const complete: DetailsInput = {
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
  insuranceChoice: "bought",
  shareAccessNeeds: false,
  declAge: true,
  declFit: true,
  declTerms: true,
};

function withOverrides(overrides: Record<string, unknown>): unknown {
  return { ...complete, ...overrides };
}

function messages(value: unknown): string[] {
  const parsed = detailsSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("detailsSchema", () => {
  it("accepts a complete submission and fills the optional fields", () => {
    const parsed = detailsSchema.safeParse(complete);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.firstName).toBe("Sam");
    expect(parsed.data.dob).toBe("2001-03-12");
    expect(parsed.data.universitySociety).toBe("");
    expect(parsed.data.studentId).toBe("");
    expect(parsed.data.emergencyRelationship).toBe("");
    expect(parsed.data.accessNeeds).toBe("");
    expect(parsed.data.insurer).toBe("");
    expect(parsed.data.policyNumber).toBe("");
    expect(parsed.data.insuranceEmergencyLine).toBe("");
  });

  it("rejects unknown keys so nothing can be mass-assigned through the form", () => {
    for (const smuggled of [
      { status: "confirmed" },
      { price: 0 },
      { base_price: 1 },
      { user_id: "00000000-0000-0000-0000-000000000000" },
      { role: "admin" },
    ]) {
      expect(detailsSchema.safeParse(withOverrides(smuggled)).success).toBe(false);
    }
  });

  it("rejects a date of birth that is not a real calendar date", () => {
    for (const dob of [
      "2011-02-30", // February has no 30th
      "2027-02-29", // 2027 is not a leap year
      "2010-99-99", // passes the digit pattern, is not a date
      "2026-13-01", // no 13th month
      "0000-01-01", // year 0 is not a year anyone was born in
    ]) {
      expect(messages(withOverrides({ dob }))).toContain("Enter a valid date of birth");
    }
  });

  it("rejects a date of birth that is not in YYYY-MM-DD form", () => {
    for (const dob of ["12/03/2001", "2001-3-1", "2001-03-12T00:00:00", "", "not a date"]) {
      expect(messages(withOverrides({ dob }))).toContain("Enter your date of birth");
    }
  });

  it("accepts a leap day", () => {
    expect(detailsSchema.safeParse(withOverrides({ dob: "2024-02-29" })).success).toBe(true);
  });

  it("leaves the 18+ decision to saveDetails, which knows the trip date", () => {
    // A four-year-old parses here on purpose: only the server, holding the
    // trip's start_date, can decide 18-on-arrival. If this ever starts failing,
    // the age rule has moved and the server gate must be re-checked.
    expect(detailsSchema.safeParse(withOverrides({ dob: "2022-06-01" })).success).toBe(true);
  });

  it("requires all three declarations", () => {
    for (const missing of [{ declAge: false }, { declFit: false }, { declTerms: false }]) {
      expect(messages(withOverrides(missing))).toContain(
        "Please confirm the three required declarations.",
      );
    }
    expect(
      messages(withOverrides({ declAge: false, declFit: false, declTerms: false })),
    ).toContain("Please confirm the three required declarations.");
  });

  it("requires a declaration to be a real boolean, not a truthy string", () => {
    expect(detailsSchema.safeParse(withOverrides({ declTerms: "true" })).success).toBe(false);
    expect(detailsSchema.safeParse(withOverrides({ marketingOptIn: "yes" })).success).toBe(false);
    expect(detailsSchema.safeParse(withOverrides({ shareAccessNeeds: 1 })).success).toBe(false);
  });

  it("requires insurer and policy number when the student brings their own cover", () => {
    const own = { insuranceChoice: "own" };
    expect(messages(withOverrides(own))).toContain("Enter your insurer and policy number.");
    expect(messages(withOverrides({ ...own, insurer: "Acme Travel" }))).toContain(
      "Enter your insurer and policy number.",
    );
    expect(
      messages(withOverrides({ ...own, insurer: "   ", policyNumber: "  " })),
    ).toContain("Enter your insurer and policy number.");
    expect(
      detailsSchema.safeParse(
        withOverrides({ ...own, insurer: "Acme Travel", policyNumber: "AC-99201" }),
      ).success,
    ).toBe(true);
  });

  it("does not ask for policy details when cover is bought through the trip", () => {
    expect(detailsSchema.safeParse(withOverrides({ insuranceChoice: "bought" })).success).toBe(
      true,
    );
    expect(detailsSchema.safeParse(withOverrides({ insuranceChoice: "none" })).success).toBe(
      false,
    );
  });

  it("holds the length and presence rules on the identity fields", () => {
    expect(messages(withOverrides({ title: "" }))).toContain("Select a title");
    expect(messages(withOverrides({ firstName: "" }))).toContain("Enter your first name");
    expect(messages(withOverrides({ lastName: "" }))).toContain("Enter your last name");
    expect(messages(withOverrides({ nationality: "" }))).toContain("Select your nationality");
    expect(messages(withOverrides({ passportNumber: "X12" }))).toContain(
      "Enter your passport number",
    );
    expect(messages(withOverrides({ phone: "0700" }))).toContain("Enter your mobile number");
    expect(messages(withOverrides({ emergencyName: "" }))).toContain(
      "Enter an emergency contact name",
    );
    expect(messages(withOverrides({ emergencyPhone: "999" }))).toContain(
      "Enter an emergency contact number",
    );
  });

  it("caps the free-text fields that are stored encrypted", () => {
    expect(detailsSchema.safeParse(withOverrides({ accessNeeds: "a".repeat(2000) })).success).toBe(
      true,
    );
    expect(detailsSchema.safeParse(withOverrides({ accessNeeds: "a".repeat(2001) })).success).toBe(
      false,
    );
    expect(detailsSchema.safeParse(withOverrides({ passportNumber: "X".repeat(61) })).success).toBe(
      false,
    );
    expect(detailsSchema.safeParse(withOverrides({ phone: "7".repeat(31) })).success).toBe(false);
  });

  it("rejects a submission that is not an object at all", () => {
    for (const value of [null, undefined, "", 0, [], "declTerms=true"]) {
      expect(detailsSchema.safeParse(value).success).toBe(false);
    }
  });
});
