// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { computePricing } from "@/lib/pricing/compute";
import { DetailsForm, type DetailsInitial } from "./DetailsForm";

/**
 * The details step is where student PII enters the system, and it is the last
 * screen before money moves. Its client-side validation used to be the real zod
 * schema; it is now a hand-rolled mirror (lib/validation/details-client.ts) so the
 * browser doesn't download zod on this page. details-client.test.ts proves the
 * mirror AGREES with the schema. This file proves the FORM does the right thing
 * with the mirror's output, which nothing covered before: the field-error mapping,
 * the aria wiring, the focus move, the plural-vs-singular summary, and the
 * key rename on submit.
 *
 * Not a substitute for the server. saveDetails re-validates with the real schema
 * and is the only check that gates a write; everything here is about what the
 * student sees and whether the right payload leaves the browser.
 */

const h = vi.hoisted(() => ({
  saveDetails: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/app/(booking)/book/actions", () => ({ saveDetails: h.saveDetails }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const pricing = computePricing({
  basePrice: 43900,
  depositAmount: 15000,
  downpaymentAmount: 5000,
  damageDepositAmount: 10000,
  extras: [],
});

/** Everything valid; individual tests break one thing at a time. */
const filled: DetailsInitial = {
  title: "Mr",
  firstName: "Sam",
  lastName: "Okafor",
  universitySociety: "",
  studentId: "",
  dob: "2001-03-12",
  nationality: "British",
  passport: "X1234567",
  phone: "+44 7700 900123",
  emergencyName: "Ada Okafor",
  emergencyRelationship: "",
  emergencyPhone: "+44 7700 900456",
  accessNeeds: "",
  insuranceChoice: "bought",
  insurer: "",
  policyNumber: "",
  insuranceEmergencyLine: "",
};

function renderForm(initial: Partial<DetailsInitial> = {}) {
  return render(
    <DetailsForm
      bookingId="b-1"
      tripName="Brumski Christmas Trip"
      tripMeta="Alpe d'Huez"
      email="sam@example.ac.uk"
      basePricing={pricing}
      coverPrice={4200}
      coverName="Winter sports cover"
      coverDescription="Medical, piste closure, kit & cancellation."
      initial={{ ...filled, ...initial }}
    />,
  );
}

const field = (name: string) => document.querySelector<HTMLElement>(`[name="${name}"]`)!;
const submitButton = () =>
  screen.getByRole("button", { name: /continue to payment/i }) as HTMLButtonElement;
const summary = () => screen.queryByRole("alert");

/**
 * The message rendered against a specific control, addressed by the very id the
 * control's aria-describedby points at. Scoped on purpose: a valid submission
 * shows the same string in BOTH the field and the sidebar summary, so an unscoped
 * text query matches twice and cannot tell the two apart.
 */
const fieldErrorText = (name: string) =>
  document.getElementById(`${name}-error`)?.textContent ?? null;

/**
 * Submit via the form's own submit event rather than a click on the button.
 * jsdom does not run the browser's implicit form-submission algorithm off a
 * button click, so a click never reaches React's onSubmit and every assertion
 * below would pass vacuously. The button's disabled gate is asserted directly
 * instead, in its own test.
 */
function submitForm() {
  fireEvent.submit(document.querySelector("form")!);
}

/** The three declarations gate the submit button, so every submit test needs them. */
function tickDeclarations() {
  for (const name of ["declAge", "declFit", "declTerms"]) {
    fireEvent.click(field(name));
  }
}

beforeEach(() => {
  h.saveDetails.mockReset();
  h.push.mockReset();
  h.saveDetails.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("DetailsForm: the declarations gate", () => {
  it("keeps submit disabled, with a reason, until all three are ticked", () => {
    renderForm();
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText(/confirm the required declarations/i)).toBeTruthy();

    fireEvent.click(field("declAge"));
    fireEvent.click(field("declFit"));
    expect(submitButton().disabled).toBe(true);

    fireEvent.click(field("declTerms"));
    expect(submitButton().disabled).toBe(false);
    expect(screen.queryByText(/confirm the required declarations/i)).toBeNull();
  });
});

describe("DetailsForm: validation display", () => {
  it("shows no errors before the first submit attempt", () => {
    renderForm({ firstName: "", title: "" });
    expect(summary()).toBeNull();
    expect(screen.queryByText("Enter your first name")).toBeNull();
    expect(field("firstName").getAttribute("aria-invalid")).toBeNull();
  });

  it("puts the message on the control that caused it, with the aria wiring", () => {
    renderForm({ firstName: "" });
    tickDeclarations();
    submitForm();

    const control = field("firstName");
    expect(control.getAttribute("aria-invalid")).toBe("true");
    // The described-by target must actually exist, or a screen reader announces
    // nothing - the id is minted by the same helper that renders the message.
    const describedBy = control.getAttribute("aria-describedby");
    expect(describedBy).toBe("firstName-error");
    expect(document.getElementById(describedBy!)?.textContent).toBe("Enter your first name");

    // Deliberately in TWO places: on the control for someone fixing that field,
    // and in the sidebar summary next to the button they just pressed.
    expect(screen.getAllByText("Enter your first name")).toHaveLength(2);
    expect(summary()?.textContent).toBe("Enter your first name");
  });

  it("uses the single message when exactly one thing is wrong", () => {
    renderForm({ firstName: "" });
    tickDeclarations();
    submitForm();
    expect(summary()?.textContent).toBe("Enter your first name");
  });

  it("uses the plural summary when more than one thing is wrong", () => {
    renderForm({ firstName: "", lastName: "" });
    tickDeclarations();
    submitForm();
    expect(summary()?.textContent).toBe("Please check the highlighted fields.");
  });

  it("uses the PLURAL summary for a missing date of birth alone", () => {
    // The regex check and the calendar check both fire, so one empty DOB is two
    // issues. Collapsing the mirror to one issue would silently change this copy.
    renderForm({ dob: "" });
    tickDeclarations();
    submitForm();
    expect(summary()?.textContent).toBe("Please check the highlighted fields.");
    // First issue per field wins, so the format message is the one shown.
    expect(fieldErrorText("dob")).toBe("Enter your date of birth");
  });

  it("shows one message for a well-formed but impossible date of birth", () => {
    renderForm({ dob: "2011-02-30" });
    tickDeclarations();
    submitForm();
    expect(summary()?.textContent).toBe("Enter a valid date of birth");
  });

  it("moves focus to the topmost broken control, not merely the first one found", () => {
    // title is declared before nationality and emergencyName in the schema, so it
    // must win regardless of DOM order or which fields are broken.
    renderForm({ title: "", nationality: "", emergencyName: "" });
    tickDeclarations();
    submitForm();
    expect(document.activeElement).toBe(field("title"));
  });

  it("clears a message as soon as the field is fixed, without another submit", () => {
    renderForm({ firstName: "" });
    tickDeclarations();
    submitForm();
    expect(fieldErrorText("firstName")).toBe("Enter your first name");

    fireEvent.change(field("firstName"), { target: { value: "Sam" } });
    expect(fieldErrorText("firstName")).toBeNull();
    expect(field("firstName").getAttribute("aria-invalid")).toBeNull();
  });

  it("does not call the server when validation fails", () => {
    renderForm({ firstName: "" });
    tickDeclarations();
    submitForm();
    expect(h.saveDetails).not.toHaveBeenCalled();
  });

  it("requires insurer and policy number when the student uses their own policy", () => {
    renderForm({ insuranceChoice: "own", insurer: "", policyNumber: "" });
    tickDeclarations();
    submitForm();
    expect(fieldErrorText("policyNumber")).toBe("Enter your insurer and policy number.");
    expect(h.saveDetails).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only policy number as missing", () => {
    renderForm({ insuranceChoice: "own", insurer: "Acme", policyNumber: "   " });
    tickDeclarations();
    submitForm();
    expect(h.saveDetails).not.toHaveBeenCalled();
  });
});

describe("DetailsForm: submitting", () => {
  it("sends the schema's key names, not the form's state key names", async () => {
    // The form holds this as `passport`; the schema calls it `passportNumber`.
    // Get the rename wrong and the server rejects every submission.
    renderForm();
    tickDeclarations();
    submitForm();

    await vi.waitFor(() => expect(h.saveDetails).toHaveBeenCalledTimes(1));
    const [bookingId, payload] = h.saveDetails.mock.calls[0];
    expect(bookingId).toBe("b-1");
    expect(payload.passportNumber).toBe("X1234567");
    expect(payload).not.toHaveProperty("passport");
    expect(payload.declAge).toBe(true);
    expect(payload.declFit).toBe(true);
    expect(payload.declTerms).toBe(true);
    // Not ticked in this run, and must not be silently defaulted to true.
    expect(payload.marketingOptIn).toBe(false);
    expect(payload.shareAccessNeeds).toBe(false);
  });

  it("navigates to payment on success", async () => {
    renderForm();
    tickDeclarations();
    submitForm();
    await vi.waitFor(() => expect(h.push).toHaveBeenCalledWith("/book/b-1/payment"));
  });

  it("surfaces a server refusal verbatim and does not navigate", async () => {
    h.saveDetails.mockResolvedValue({
      ok: false,
      error: "You must be 18 or over on arrival in resort.",
    });
    renderForm();
    tickDeclarations();
    submitForm();

    await vi.waitFor(() =>
      expect(summary()?.textContent).toBe("You must be 18 or over on arrival in resort."),
    );
    expect(h.push).not.toHaveBeenCalled();
  });

  it("never reports a dropped request as saved", async () => {
    h.saveDetails.mockRejectedValue(new Error("network down"));
    renderForm();
    tickDeclarations();
    submitForm();

    await vi.waitFor(() => expect(summary()?.textContent).toMatch(/couldn't save your details/i));
    expect(h.push).not.toHaveBeenCalled();
  });
});
