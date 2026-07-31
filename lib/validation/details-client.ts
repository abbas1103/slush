import type { DetailsInput } from "@/lib/validation/details";

/**
 * Dependency-free mirror of `detailsSchema` for the BROWSER.
 *
 * `DetailsForm` is a client component, and importing the zod schema into it pulled
 * the whole zod runtime (288 KB raw / 66 KB gzipped) into the bundle for
 * /book/<id>/details - the passport-and-DOB form immediately before payment, and
 * the one screen most likely to be loaded on a phone on hall wifi. It was the only
 * client edge into zod in the app.
 *
 * THIS IS NOT A SECURITY BOUNDARY and removing zod from the client weakens nothing.
 * `saveDetails` re-validates every field with the real `detailsSchema` (plus the
 * 18+ gate, which needs the trip date and was always server-only), and that is the
 * only check that decides whether anything is written. This exists purely so a
 * student sees every problem at once, on the control that caused it, instead of one
 * anonymous message per round trip (audit #79).
 *
 * It must therefore stay behaviourally identical to `detailsSchema` in the ways the
 * FORM depends on, which are subtler than they look:
 *
 *  - **Issue order is declaration order.** The form focuses the control named by
 *    the first issue, so reordering these checks moves the cursor somewhere else.
 *  - **An empty or malformed `dob` must produce TWO issues** (the format check and
 *    the calendar check both run, as they do in zod 4). This is why "everything
 *    filled except DOB" shows the plural "Please check the highlighted fields."
 *    rather than a single message. Collapsing it to one issue changes visible copy.
 *  - **The two object-level rules run after a CONSTRAINT failure but not after a
 *    TYPE failure.** zod 4 treats a wrong JS type (or an off-list enum value) as
 *    fatal and skips object-level refinements; a min/max/regex violation is not
 *    fatal and the refinements still run. Verified against the schema, not assumed:
 *    `{firstName:"", declTerms:false}` yields two issues, `{declTerms:"true"}`
 *    yields one. The `fatal` flag below is what reproduces that.
 *  - **Booleans are not coerced.** `"true"` is a failure, not a pass.
 *  - **`.trim()` applies** to the own-insurance insurer/policy check.
 *  - **Unknown keys are rejected**, mirroring `.strict()` (mass-assignment guard).
 *
 * Kept in sync by `details-client.test.ts`, which mirrors `details.test.ts`
 * case-for-case. If you change one schema, change both and run the pair.
 */

export interface DetailsIssue {
  path: [string];
  message: string;
}

export type DetailsValidation =
  | { success: true }
  | { success: false; error: { issues: DetailsIssue[] } };

/** Every key the schema accepts, in declaration order. Also the `.strict()` allow-list. */
const KEYS = [
  "title",
  "firstName",
  "lastName",
  "universitySociety",
  "studentId",
  "dob",
  "nationality",
  "passportNumber",
  "phone",
  "emergencyName",
  "emergencyRelationship",
  "emergencyPhone",
  "accessNeeds",
  "marketingOptIn",
  "insuranceChoice",
  "insurer",
  "policyNumber",
  "insuranceEmergencyLine",
  "shareAccessNeeds",
  "declAge",
  "declFit",
  "declTerms",
] as const;

/** `.default("")` in the schema: an absent optional string validates as "". */
const OPTIONAL_STRINGS = new Set([
  "universitySociety",
  "studentId",
  "emergencyRelationship",
  "accessNeeds",
  "insurer",
  "policyNumber",
  "insuranceEmergencyLine",
]);

/** min/max and the messages, in declaration order. `min: 0` means presence isn't required. */
const STRING_RULES: {
  key: string;
  min?: number;
  minMessage?: string;
  max: number;
  maxMessage: string;
}[] = [
  { key: "title", min: 1, minMessage: "Select a title", max: Infinity, maxMessage: "" },
  { key: "firstName", min: 1, minMessage: "Enter your first name", max: Infinity, maxMessage: "" },
  { key: "lastName", min: 1, minMessage: "Enter your last name", max: Infinity, maxMessage: "" },
  { key: "universitySociety", max: 120, maxMessage: "Use 120 characters or fewer" },
  { key: "studentId", max: 60, maxMessage: "Use 60 characters or fewer" },
  // dob is handled separately: it has two independent checks, not a min/max.
  { key: "nationality", min: 1, minMessage: "Select your nationality", max: Infinity, maxMessage: "" },
  {
    key: "passportNumber",
    min: 4,
    minMessage: "Enter your passport number",
    max: 60,
    maxMessage: "Use 60 characters or fewer",
  },
  { key: "phone", min: 5, minMessage: "Enter your mobile number", max: 30, maxMessage: "Use 30 characters or fewer" },
  {
    key: "emergencyName",
    min: 1,
    minMessage: "Enter an emergency contact name",
    max: Infinity,
    maxMessage: "",
  },
  { key: "emergencyRelationship", max: 60, maxMessage: "Use 60 characters or fewer" },
  {
    key: "emergencyPhone",
    min: 5,
    minMessage: "Enter an emergency contact number",
    max: 30,
    maxMessage: "Use 30 characters or fewer",
  },
  { key: "accessNeeds", max: 2000, maxMessage: "Use 2000 characters or fewer" },
  { key: "insurer", max: 120, maxMessage: "Use 120 characters or fewer" },
  { key: "policyNumber", max: 120, maxMessage: "Use 120 characters or fewer" },
  { key: "insuranceEmergencyLine", max: 60, maxMessage: "Use 60 characters or fewer" },
];

const DOB_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The same calendar round-trip the schema uses: rejects 2011-02-30, 2010-99-99,
 * 2026-13-01 and 0000-01-01, which the format check alone lets through. Without it
 * the server's age maths sees an Invalid Date, and `NaN < 18` is false, which would
 * skip the 18+ gate entirely (audit #4).
 */
function isRealCalendarDate(s: string): boolean {
  const [y, m, day] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

/** Mirrors `detailsSchema.safeParse`, minus the parsing (the form builds the object). */
export function validateDetails(input: DetailsInput | unknown): DetailsValidation {
  const issues: DetailsIssue[] = [];
  const fail = (key: string, message: string) => issues.push({ path: [key], message });

  /**
   * Set when a value is the WRONG TYPE (or an off-list enum value), which zod
   * treats as fatal: the object never parses, so its `.refine()`s never run. A
   * mere min/max/regex violation does not set this, and the refines do run.
   */
  let fatal = false;

  // Non-objects: zod reports an invalid_type at the root. The form can't produce
  // one, but parity matters if this is ever reused.
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, error: { issues: [{ path: [""], message: "Please check your details." }] } };
  }
  const d = input as Record<string, unknown>;

  // .strict(): unknown keys are a hard failure, so a renamed field can never be
  // silently ignored here while the server rejects the whole payload.
  for (const key of Object.keys(d)) {
    if (!(KEYS as readonly string[]).includes(key)) {
      return {
        success: false,
        error: { issues: [{ path: [""], message: `Unrecognized key: "${key}"` }] },
      };
    }
  }

  for (const rule of STRING_RULES) {
    const raw = d[rule.key];
    const optional = OPTIONAL_STRINGS.has(rule.key);
    if (raw === undefined && optional) continue; // .default("") satisfies every rule
    if (typeof raw !== "string") {
      fatal = true;
      fail(rule.key, rule.minMessage ?? "Please check this field");
      continue;
    }
    if (rule.min !== undefined && raw.length < rule.min) {
      fail(rule.key, rule.minMessage ?? "Please check this field");
      continue; // one issue per field, as zod does for chained length checks
    }
    if (raw.length > rule.max) fail(rule.key, rule.maxMessage);
  }

  // dob sits outside STRING_RULES because BOTH of its checks run independently -
  // reproducing the two-issue result the form's plural summary depends on.
  const dob = d.dob;
  if (typeof dob !== "string") {
    fatal = true;
    fail("dob", "Enter your date of birth");
  } else {
    // Both checks run independently, which is what produces the two-issue result
    // the form's plural summary depends on for an empty or malformed date.
    if (!DOB_FORMAT.test(dob)) fail("dob", "Enter your date of birth");
    if (!isRealCalendarDate(dob)) fail("dob", "Enter a valid date of birth");
  }

  if (d.marketingOptIn !== true && d.marketingOptIn !== false) {
    fatal = true;
    fail("marketingOptIn", "Please check this field");
  }

  // An off-list enum value is fatal in zod, same as a type error.
  if (d.insuranceChoice !== "own" && d.insuranceChoice !== "bought") {
    fatal = true;
    fail("insuranceChoice", "Choose an insurance option");
  }

  for (const key of ["shareAccessNeeds", "declAge", "declFit", "declTerms"]) {
    if (d[key] !== true && d[key] !== false) {
      fatal = true;
      fail(key, "Please check this field");
    }
  }

  // Object-level rules, in schema order. Skipped entirely when a type/enum failure
  // above was fatal, because zod's object never parsed and so never ran them.
  if (fatal) return { success: false, error: { issues } };

  if (!(d.declAge === true && d.declFit === true && d.declTerms === true)) {
    fail("declTerms", "Please confirm the three required declarations.");
  }

  const insurer = typeof d.insurer === "string" ? d.insurer : "";
  const policyNumber = typeof d.policyNumber === "string" ? d.policyNumber : "";
  if (d.insuranceChoice === "own" && !(insurer.trim() && policyNumber.trim())) {
    fail("policyNumber", "Enter your insurer and policy number.");
  }

  return issues.length === 0 ? { success: true } : { success: false, error: { issues } };
}
