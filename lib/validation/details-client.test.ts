import { describe, it, expect } from "vitest";
import { detailsSchema, type DetailsInput } from "./details";
import { validateDetails } from "./details-client";

/**
 * `validateDetails` is a hand-rolled mirror of `detailsSchema`, written so the
 * browser doesn't have to download zod on the PII step (66 KB gzipped). Two
 * implementations of one rule set is a drift risk, so this suite is deliberately
 * DIFFERENTIAL: almost every case asserts the mirror agrees with the real schema
 * rather than asserting a hardcoded expectation. Change either one and the pair
 * fails, which is the point.
 *
 * The server is unaffected either way - `saveDetails` validates with
 * `detailsSchema` and is the only check that gates a write. This is about the form
 * showing a student the same thing the server would.
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

const withOverrides = (overrides: Record<string, unknown>): unknown => ({
  ...complete,
  ...overrides,
});

/** The two things the FORM reads off a result: did it pass, and which fields failed. */
function shape(value: unknown) {
  const zodResult = detailsSchema.safeParse(value);
  const mirror = validateDetails(value);
  return {
    zod: {
      success: zodResult.success,
      paths: zodResult.success ? [] : zodResult.error.issues.map((i) => String(i.path[0] ?? "")),
    },
    mirror: {
      success: mirror.success,
      paths: mirror.success ? [] : mirror.error.issues.map((i) => String(i.path[0] ?? "")),
    },
  };
}

/** Assert the mirror and the schema agree on pass/fail AND on the failing fields. */
function expectParity(value: unknown) {
  const { zod, mirror } = shape(value);
  expect(mirror.success, `success disagreed for ${JSON.stringify(value)}`).toBe(zod.success);
  expect(mirror.paths, `issue paths disagreed for ${JSON.stringify(value)}`).toEqual(zod.paths);
}

describe("validateDetails: parity with detailsSchema", () => {
  it("agrees on a complete submission", () => {
    expectParity(complete);
    expect(validateDetails(complete).success).toBe(true);
  });

  it("agrees when the optional (defaulted) fields are absent or present", () => {
    expectParity(complete);
    expectParity(
      withOverrides({
        universitySociety: "UoB Snowsports",
        studentId: "2098111",
        emergencyRelationship: "Mother",
        accessNeeds: "Nut allergy",
        insurer: "",
        policyNumber: "",
        insuranceEmergencyLine: "",
      }),
    );
  });

  it("agrees on unknown keys (mass-assignment guard)", () => {
    for (const extra of [
      { status: "confirmed" },
      { price: 0 },
      { base_price: 1 },
      { user_id: "00000000-0000-0000-0000-000000000000" },
      { role: "admin" },
    ]) {
      const { zod, mirror } = shape(withOverrides(extra));
      expect(zod.success).toBe(false);
      expect(mirror.success).toBe(false);
    }
  });

  it("agrees on calendar-impossible dates of birth", () => {
    for (const dob of ["2011-02-30", "2027-02-29", "2010-99-99", "2026-13-01", "0000-01-01"]) {
      expectParity(withOverrides({ dob }));
    }
  });

  it("agrees on badly formatted dates of birth", () => {
    for (const dob of ["12/03/2001", "2001-3-1", "2001-03-12T00:00:00", "", "not a date"]) {
      expectParity(withOverrides({ dob }));
    }
  });

  it("agrees that a leap day is valid", () => {
    expectParity(withOverrides({ dob: "2024-02-29" }));
    expect(validateDetails(withOverrides({ dob: "2024-02-29" })).success).toBe(true);
  });

  it("agrees that the 18+ rule is NOT applied here (it needs the trip date)", () => {
    // A four-year-old must PARSE. saveDetails does the age arithmetic against
    // trips.start_date; if this ever starts failing, the rule has moved.
    expectParity(withOverrides({ dob: "2022-06-01" }));
    expect(validateDetails(withOverrides({ dob: "2022-06-01" })).success).toBe(true);
  });

  it("agrees on the three required declarations", () => {
    expectParity(withOverrides({ declAge: false }));
    expectParity(withOverrides({ declFit: false }));
    expectParity(withOverrides({ declTerms: false }));
    expectParity(withOverrides({ declAge: false, declFit: false, declTerms: false }));
  });

  it("agrees that booleans are not coerced", () => {
    expectParity(withOverrides({ declTerms: "true" }));
    expectParity(withOverrides({ marketingOptIn: "yes" }));
    expectParity(withOverrides({ shareAccessNeeds: 1 }));
  });

  it("agrees that own insurance requires a real insurer and policy number", () => {
    expectParity(withOverrides({ insuranceChoice: "own" }));
    expectParity(withOverrides({ insuranceChoice: "own", insurer: "Acme" }));
    expectParity(withOverrides({ insuranceChoice: "own", insurer: "   ", policyNumber: "  " }));
    expectParity(withOverrides({ insuranceChoice: "own", insurer: "Acme", policyNumber: "P-1" }));
  });

  it("agrees that bought insurance needs no policy details, and rejects other values", () => {
    expectParity(withOverrides({ insuranceChoice: "bought" }));
    expectParity(withOverrides({ insuranceChoice: "none" }));
  });

  it("agrees on presence and length rules for the identity fields", () => {
    expectParity(withOverrides({ title: "" }));
    expectParity(withOverrides({ firstName: "" }));
    expectParity(withOverrides({ lastName: "" }));
    expectParity(withOverrides({ nationality: "" }));
    expectParity(withOverrides({ passportNumber: "X12" }));
    expectParity(withOverrides({ phone: "0700" }));
    expectParity(withOverrides({ emergencyName: "" }));
    expectParity(withOverrides({ emergencyPhone: "999" }));
  });

  it("agrees on the maximum lengths", () => {
    expectParity(withOverrides({ accessNeeds: "x".repeat(2000) }));
    expectParity(withOverrides({ accessNeeds: "x".repeat(2001) }));
    expectParity(withOverrides({ passportNumber: "x".repeat(61) }));
    expectParity(withOverrides({ phone: "0".repeat(31) }));
    expectParity(withOverrides({ universitySociety: "x".repeat(121) }));
    expectParity(withOverrides({ studentId: "x".repeat(61) }));
    expectParity(withOverrides({ emergencyRelationship: "x".repeat(61) }));
    expectParity(withOverrides({ insurer: "x".repeat(121) }));
    expectParity(withOverrides({ insuranceEmergencyLine: "x".repeat(61) }));
  });

  it("agrees that non-objects are rejected", () => {
    for (const value of [null, undefined, "", 0, [], "declTerms=true"]) {
      const { zod, mirror } = shape(value);
      expect(zod.success).toBe(false);
      expect(mirror.success).toBe(false);
    }
  });
});

/**
 * The form reads more than pass/fail off the result, and these three behaviours
 * decide what a student actually sees. Asserted against the real schema too, but
 * spelled out because they are the ones a well-meaning "simplification" breaks.
 */
describe("validateDetails: the behaviours DetailsForm depends on", () => {
  it("emits TWO issues for an empty dob, so the summary stays plural", () => {
    // The form shows "Please check the highlighted fields." when issues.length > 1
    // and a single message otherwise. An empty DOB alone must hit the plural path.
    const value = withOverrides({ dob: "" });
    const zodIssues = detailsSchema.safeParse(value);
    const mirror = validateDetails(value);
    expect(zodIssues.success).toBe(false);
    expect(mirror.success).toBe(false);
    if (zodIssues.success || mirror.success) return;

    const zodDob = zodIssues.error.issues.filter((i) => i.path[0] === "dob");
    const mirrorDob = mirror.error.issues.filter((i) => i.path[0] === "dob");
    expect(mirrorDob).toHaveLength(2);
    expect(mirrorDob.length).toBe(zodDob.length);
    expect(mirrorDob.map((i) => i.message)).toEqual([
      "Enter your date of birth",
      "Enter a valid date of birth",
    ]);
  });

  it("emits ONE issue for a well-formed but impossible dob", () => {
    const mirror = validateDetails(withOverrides({ dob: "2011-02-30" }));
    expect(mirror.success).toBe(false);
    if (mirror.success) return;
    expect(mirror.error.issues.filter((i) => i.path[0] === "dob")).toHaveLength(1);
    expect(mirror.error.issues[0].message).toBe("Enter a valid date of birth");
  });

  it("orders issues by field declaration order, so focus lands on the topmost control", () => {
    // title is declared first, emergencyName much later: whatever else is wrong,
    // the first issue must be the one nearest the top of the form.
    const mirror = validateDetails(
      withOverrides({ title: "", emergencyName: "", nationality: "" }),
    );
    expect(mirror.success).toBe(false);
    if (mirror.success) return;
    expect(mirror.error.issues.map((i) => i.path[0])).toEqual([
      "title",
      "nationality",
      "emergencyName",
    ]);

    const zodResult = detailsSchema.safeParse(
      withOverrides({ title: "", emergencyName: "", nationality: "" }),
    );
    expect(zodResult.success).toBe(false);
    if (zodResult.success) return;
    expect(mirror.error.issues.map((i) => String(i.path[0]))).toEqual(
      zodResult.error.issues.map((i) => String(i.path[0])),
    );
  });

  it("still applies the object-level rules when field checks have already failed", () => {
    const mirror = validateDetails(withOverrides({ firstName: "", declTerms: false }));
    expect(mirror.success).toBe(false);
    if (mirror.success) return;
    const paths = mirror.error.issues.map((i) => i.path[0]);
    expect(paths).toContain("firstName");
    expect(paths).toContain("declTerms");
  });

  /**
   * The distinction that is easy to get wrong, and did get written wrong first
   * time: in zod 4 a CONSTRAINT failure (min/max/regex) leaves the object-level
   * refinements running, but a TYPE failure - or an off-list enum value - is fatal
   * and skips them. Get this backwards and a student with a stray non-boolean sees
   * a spurious "confirm the three declarations" they cannot clear.
   */
  it.each([
    // [description, overrides, expected number of issues]
    ["constraint failure keeps the declarations rule", { firstName: "", declTerms: false }, 2],
    ["constraint failure keeps the insurance rule", { passportNumber: "x".repeat(61), insuranceChoice: "own" }, 2],
    ["type failure on a string is fatal", { firstName: 123, declTerms: false }, 1],
    ["type failure on a boolean is fatal", { marketingOptIn: "yes", insuranceChoice: "own" }, 1],
    ["off-list enum value is fatal", { insuranceChoice: "none", declTerms: false }, 1],
  ])("%s", (_label, overrides, expected) => {
    const value = withOverrides(overrides as Record<string, unknown>);
    const zodResult = detailsSchema.safeParse(value);
    const mirror = validateDetails(value);
    expect(zodResult.success).toBe(false);
    expect(mirror.success).toBe(false);
    if (zodResult.success || mirror.success) return;
    expect(mirror.error.issues).toHaveLength(expected);
    expect(mirror.error.issues.map((i) => String(i.path[0]))).toEqual(
      zodResult.error.issues.map((i) => String(i.path[0])),
    );
  });
});
