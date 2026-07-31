"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveDetails } from "@/app/(booking)/book/actions";
import type { DetailsInput } from "@/lib/validation/details";
import { validateDetails } from "@/lib/validation/details-client";
import type { Pricing } from "@/lib/pricing/compute";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { OptionRow } from "@/components/ui/OptionRow";
import { Money } from "@/components/ui/Money";
import { SummarySidebar } from "./SummarySidebar";

export interface DetailsInitial {
  title: string;
  firstName: string;
  lastName: string;
  universitySociety: string;
  studentId: string;
  dob: string;
  nationality: string;
  passport: string;
  phone: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  accessNeeds: string;
  insuranceChoice: "own" | "bought";
  insurer: string;
  policyNumber: string;
  insuranceEmergencyLine: string;
}

interface Props {
  bookingId: string;
  tripName: string;
  tripMeta: string;
  email: string;
  basePricing: Pricing; // excludes insurance cover
  coverPrice: number;
  coverName: string; // the cover extra's DB name (admin-editable), not a hardcoded label
  coverDescription: string; // the cover extra's DB description
  initial: DetailsInitial;
}

export function DetailsForm({ bookingId, tripName, tripMeta, email, basePricing, coverPrice, coverName, coverDescription, initial }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [f, setF] = useState<DetailsInitial>(initial);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [shareAccessNeeds, setShareAccessNeeds] = useState(false);
  const [declAge, setDeclAge] = useState(false);
  const [declFit, setDeclFit] = useState(false);
  const [declTerms, setDeclTerms] = useState(false);

  const set = (k: keyof DetailsInitial) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const buyInsurance = f.insuranceChoice === "bought";
  const pricing: Pricing = buyInsurance
    ? {
        ...basePricing,
        lineItems: [...basePricing.lineItems, { label: coverName, amount: coverPrice }],
        tripCost: basePricing.tripCost + coverPrice,
        balanceAfterDeposit: basePricing.balanceAfterDeposit + coverPrice,
        payInFullToday: basePricing.payInFullToday + coverPrice,
      }
    : basePricing;

  const canContinue = declAge && declFit && declTerms;

  const input: DetailsInput = {
    title: f.title,
    firstName: f.firstName,
    lastName: f.lastName,
    universitySociety: f.universitySociety,
    studentId: f.studentId,
    dob: f.dob,
    nationality: f.nationality,
    passportNumber: f.passport,
    phone: f.phone,
    emergencyName: f.emergencyName,
    emergencyRelationship: f.emergencyRelationship,
    emergencyPhone: f.emergencyPhone,
    accessNeeds: f.accessNeeds,
    marketingOptIn,
    insuranceChoice: f.insuranceChoice,
    insurer: f.insurer,
    policyNumber: f.policyNumber,
    insuranceEmergencyLine: f.insuranceEmergencyLine,
    shareAccessNeeds,
    declAge,
    declFit,
    declTerms,
  };

  // Checked in the browser so a student sees every problem at once, on the
  // control that caused it, instead of one anonymous message per round trip
  // (audit #79). Only once they've tried to submit, so the form isn't red before
  // they've started, and re-checked on every keystroke after that so a message
  // clears as soon as it's fixed.
  //
  // A hand-rolled mirror of detailsSchema, NOT the schema itself: importing zod
  // here put its whole 66 KB gzipped runtime into the bundle for this page. The
  // server still validates with the real schema in saveDetails, which is the only
  // check that gates a write - see lib/validation/details-client.ts.
  const parsed = validateDetails(input);
  const fieldErrors: Record<string, string> = {};
  if (attempted && !parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
  }

  /** The field's message, with an id so its control can point at it. */
  const fieldError = (name: string) =>
    fieldErrors[name] ? <span id={`${name}-error`}>{fieldErrors[name]}</span> : undefined;

  /** Screen-reader wiring for the control itself. */
  const errorProps = (name: string): { "aria-invalid"?: true; "aria-describedby"?: string } =>
    fieldErrors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAttempted(true);

    if (!parsed.success) {
      const issues = parsed.error.issues;
      setError(
        issues.length > 1
          ? "Please check the highlighted fields."
          : (issues[0]?.message ?? "Please check your details."),
      );
      // Move focus to the first field at fault - a message on its own leaves a
      // keyboard or screen-reader user with nothing to act on.
      const first = String(issues[0]?.path[0] ?? "");
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    startTransition(async () => {
      try {
        const r = await saveDetails(bookingId, input);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        router.push(`/book/${bookingId}/payment`);
      } catch {
        // A dropped request must never look like a saved one.
        setError("Couldn't save your details - please check your connection and try again.");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mx-auto grid max-w-[1120px] gap-8 px-6 py-8 xl:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <div>
          <h1>Your details</h1>
          <p className="mt-2 text-[15px] text-soft">
            You&apos;re booking one place - just your details. Enter your name
            exactly as it appears on your passport.
          </p>
        </div>

        <Card>
          <h3>About you</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Title" error={fieldError("title")}>
              <Select
                name="title"
                value={f.title}
                onChange={set("title")}
                required
                {...errorProps("title")}
              >
                <option value="">Select</option>
                <option>Mr</option>
                <option>Ms</option>
                <option>Mx</option>
              </Select>
            </Field>
            <Field label="First name(s)" error={fieldError("firstName")}>
              <Input
                name="firstName"
                value={f.firstName}
                onChange={set("firstName")}
                required
                {...errorProps("firstName")}
              />
            </Field>
            <Field label="Last name" error={fieldError("lastName")}>
              <Input
                name="lastName"
                value={f.lastName}
                onChange={set("lastName")}
                required
                {...errorProps("lastName")}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="University / Society" error={fieldError("universitySociety")}>
              <Input
                name="universitySociety"
                value={f.universitySociety}
                onChange={set("universitySociety")}
                {...errorProps("universitySociety")}
              />
            </Field>
            <Field label="Student ID / membership no." error={fieldError("studentId")}>
              <Input
                name="studentId"
                value={f.studentId}
                onChange={set("studentId")}
                {...errorProps("studentId")}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Date of birth" error={fieldError("dob")}>
              <Input
                name="dob"
                type="date"
                value={f.dob}
                onChange={set("dob")}
                required
                {...errorProps("dob")}
              />
            </Field>
            <Field label="Nationality" error={fieldError("nationality")}>
              <Select
                name="nationality"
                value={f.nationality}
                onChange={set("nationality")}
                required
                {...errorProps("nationality")}
              >
                <option value="">Select</option>
                <option>British</option>
                <option>Other</option>
              </Select>
            </Field>
            <Field
              label="Passport number"
              hint="Stored encrypted"
              error={fieldError("passportNumber")}
            >
              <Input
                name="passportNumber"
                value={f.passport}
                onChange={set("passport")}
                required
                {...errorProps("passportNumber")}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Email address">
              <Input value={email} disabled />
            </Field>
            <Field label="Mobile number" error={fieldError("phone")}>
              <Input
                name="phone"
                value={f.phone}
                onChange={set("phone")}
                required
                {...errorProps("phone")}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h3>Emergency contact</h3>
          <p className="mt-1 text-[13px] text-soft">Someone we can reach if needed while you&apos;re away.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Full name" error={fieldError("emergencyName")}>
              <Input
                name="emergencyName"
                value={f.emergencyName}
                onChange={set("emergencyName")}
                required
                {...errorProps("emergencyName")}
              />
            </Field>
            <Field label="Relationship" error={fieldError("emergencyRelationship")}>
              <Input
                name="emergencyRelationship"
                value={f.emergencyRelationship}
                onChange={set("emergencyRelationship")}
                {...errorProps("emergencyRelationship")}
              />
            </Field>
            <Field label="Contact number" error={fieldError("emergencyPhone")}>
              <Input
                name="emergencyPhone"
                value={f.emergencyPhone}
                onChange={set("emergencyPhone")}
                required
                {...errorProps("emergencyPhone")}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h3>Anything we should know?</h3>
          <p className="mt-1 text-[13px] text-soft">Medical or access requirements - optional.</p>
          <Textarea
            className="mt-3"
            name="accessNeeds"
            rows={3}
            value={f.accessNeeds}
            onChange={set("accessNeeds")}
            placeholder="e.g. ground-floor room, medication, access needs…"
            {...errorProps("accessNeeds")}
          />
          {fieldErrors.accessNeeds && (
            <p id="accessNeeds-error" className="mt-1.5 text-[12.5px] text-err">
              {fieldErrors.accessNeeds}
            </p>
          )}
          <div className="mt-3">
            <Checkbox
              name="marketingOptIn"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
            >
              Send me the resort guide and trip updates by email.
            </Checkbox>
          </div>
        </Card>

        <Card>
          <h3>Insurance</h3>
          <p className="mt-1 text-[13px] text-soft">{coverName} is required for this trip.</p>
          <div className="mt-3 flex flex-col gap-2.5">
            <OptionRow
              title="I have my own winter sports insurance"
              desc="Enter your policy details below."
              selected={f.insuranceChoice === "own"}
              onClick={() => setF((p) => ({ ...p, insuranceChoice: "own" }))}
            />
            {f.insuranceChoice === "own" && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Insurer" error={fieldError("insurer")}>
                  <Input
                    name="insurer"
                    value={f.insurer}
                    onChange={set("insurer")}
                    required
                    {...errorProps("insurer")}
                  />
                </Field>
                <Field label="Policy number" error={fieldError("policyNumber")}>
                  <Input
                    name="policyNumber"
                    value={f.policyNumber}
                    onChange={set("policyNumber")}
                    required
                    {...errorProps("policyNumber")}
                  />
                </Field>
                <Field label="Emergency line" error={fieldError("insuranceEmergencyLine")}>
                  <Input
                    name="insuranceEmergencyLine"
                    value={f.insuranceEmergencyLine}
                    onChange={set("insuranceEmergencyLine")}
                    {...errorProps("insuranceEmergencyLine")}
                  />
                </Field>
              </div>
            )}
            <OptionRow
              title={<>Add {coverName} - <Money pence={coverPrice} stripZeros /></>}
              desc={coverDescription}
              selected={f.insuranceChoice === "bought"}
              onClick={() => setF((p) => ({ ...p, insuranceChoice: "bought" }))}
            />
          </div>
        </Card>

        <Card>
          <h3>Declarations &amp; terms</h3>
          <p className="mt-1 text-[13px] text-soft">
            Please confirm the following to complete your booking. The terms open in a new tab, so
            nothing you&apos;ve typed is lost.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <Checkbox name="declAge" checked={declAge} onChange={(e) => setDeclAge(e.target.checked)}>
              I confirm I will be 18 or over on arrival in resort.
            </Checkbox>
            <Checkbox name="declFit" checked={declFit} onChange={(e) => setDeclFit(e.target.checked)}>
              I am fit to travel and have disclosed any medical or access needs above.
            </Checkbox>
            <Checkbox name="declTerms" checked={declTerms} onChange={(e) => setDeclTerms(e.target.checked)}>
              {/* Linked at the point of consent: a student can't accept documents
                  they have no way of reading from inside the flow (audit #33). */}
              I have read and accept the{" "}
              <Link href="/terms#booking" target="_blank" rel="noopener" className="underline">
                Booking Conditions
              </Link>
              , the{" "}
              {/* #cancellations is the id the terms page defines; #refunds
                  resolved nowhere, so this landed the student at the top of the
                  document at the exact moment they consent. */}
              <Link href="/terms#cancellations" target="_blank" rel="noopener" className="underline">
                Refund Policy
              </Link>{" "}
              and the{" "}
              <Link href="/terms" target="_blank" rel="noopener" className="underline">
                Trip Terms
              </Link>
              .
            </Checkbox>
            <Checkbox
              name="shareAccessNeeds"
              checked={shareAccessNeeds}
              onChange={(e) => setShareAccessNeeds(e.target.checked)}
            >
              I&apos;d like SLUSH to share my access needs with the resort.
            </Checkbox>
          </div>
        </Card>
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start">
        <SummarySidebar pricing={pricing} tripName={tripName} tripMeta={tripMeta}>
          <div className="mt-3 rounded-btn bg-soft-panel px-3 py-2 text-center text-[13px] text-ink-2">
            🔒 Pay <Money pence={pricing.depositToday} stripZeros /> deposit today
          </div>
          {error && (
            <p role="alert" className="mt-2 rounded-btn bg-errbg px-3 py-2 text-[13px] text-err">
              {error}
            </p>
          )}
          <Button type="submit" className="mt-3 w-full" disabled={pending || !canContinue}>
            {pending ? "Saving…" : "Continue to payment →"}
          </Button>
          {!canContinue && (
            <p className="mt-2 text-center text-[12px] text-soft">
              Confirm the required declarations to continue.
            </p>
          )}
        </SummarySidebar>
      </aside>
    </form>
  );
}
