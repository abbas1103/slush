"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDetails } from "@/app/(booking)/book/actions";
import type { DetailsInput } from "@/lib/validation/details";
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
  initial: DetailsInitial;
}

export function DetailsForm({ bookingId, tripName, tripMeta, email, basePricing, coverPrice, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
        lineItems: [...basePricing.lineItems, { label: "Winter sports cover", amount: coverPrice }],
        tripCost: basePricing.tripCost + coverPrice,
        balanceAfterDeposit: basePricing.balanceAfterDeposit + coverPrice,
        payInFullToday: basePricing.payInFullToday + coverPrice,
      }
    : basePricing;

  const canContinue = declAge && declFit && declTerms;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
    startTransition(async () => {
      const r = await saveDetails(bookingId, input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/book/${bookingId}/payment`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto grid max-w-[1120px] gap-8 px-6 py-8 xl:grid-cols-[1fr_360px]">
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
            <Field label="Title">
              <Select value={f.title} onChange={set("title")}>
                <option value="">Select</option>
                <option>Mr</option>
                <option>Ms</option>
                <option>Mx</option>
              </Select>
            </Field>
            <Field label="First name(s)">
              <Input value={f.firstName} onChange={set("firstName")} required />
            </Field>
            <Field label="Last name">
              <Input value={f.lastName} onChange={set("lastName")} required />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="University / Society">
              <Input value={f.universitySociety} onChange={set("universitySociety")} />
            </Field>
            <Field label="Student ID / membership no.">
              <Input value={f.studentId} onChange={set("studentId")} />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Date of birth">
              <Input type="date" value={f.dob} onChange={set("dob")} required />
            </Field>
            <Field label="Nationality">
              <Select value={f.nationality} onChange={set("nationality")}>
                <option value="">Select</option>
                <option>British</option>
                <option>Other</option>
              </Select>
            </Field>
            <Field label="Passport number" hint="Stored encrypted">
              <Input value={f.passport} onChange={set("passport")} required />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Email address">
              <Input value={email} disabled />
            </Field>
            <Field label="Mobile number">
              <Input value={f.phone} onChange={set("phone")} required />
            </Field>
          </div>
        </Card>

        <Card>
          <h3>Emergency contact</h3>
          <p className="mt-1 text-[13px] text-soft">Someone we can reach if needed while you&apos;re away.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Full name">
              <Input value={f.emergencyName} onChange={set("emergencyName")} required />
            </Field>
            <Field label="Relationship">
              <Input value={f.emergencyRelationship} onChange={set("emergencyRelationship")} />
            </Field>
            <Field label="Contact number">
              <Input value={f.emergencyPhone} onChange={set("emergencyPhone")} required />
            </Field>
          </div>
        </Card>

        <Card>
          <h3>Anything we should know?</h3>
          <p className="mt-1 text-[13px] text-soft">Medical or access requirements - optional.</p>
          <Textarea
            className="mt-3"
            rows={3}
            value={f.accessNeeds}
            onChange={set("accessNeeds")}
            placeholder="e.g. ground-floor room, medication, access needs…"
          />
          <div className="mt-3">
            <Checkbox checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)}>
              Send me the resort guide and trip updates by email.
            </Checkbox>
          </div>
        </Card>

        <Card>
          <h3>Insurance</h3>
          <p className="mt-1 text-[13px] text-soft">Winter sports cover is required for this trip.</p>
          <div className="mt-3 flex flex-col gap-2.5">
            <OptionRow
              title="I have my own winter sports insurance"
              desc="Enter your policy details below."
              selected={f.insuranceChoice === "own"}
              onClick={() => setF((p) => ({ ...p, insuranceChoice: "own" }))}
            />
            {f.insuranceChoice === "own" && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Insurer">
                  <Input value={f.insurer} onChange={set("insurer")} />
                </Field>
                <Field label="Policy number">
                  <Input value={f.policyNumber} onChange={set("policyNumber")} />
                </Field>
                <Field label="Emergency line">
                  <Input value={f.insuranceEmergencyLine} onChange={set("insuranceEmergencyLine")} />
                </Field>
              </div>
            )}
            <OptionRow
              title={<>Add winter sports cover - <Money pence={coverPrice} stripZeros /></>}
              desc="Medical, piste closure, kit & cancellation."
              selected={f.insuranceChoice === "bought"}
              onClick={() => setF((p) => ({ ...p, insuranceChoice: "bought" }))}
            />
          </div>
        </Card>

        <Card>
          <h3>Declarations &amp; terms</h3>
          <p className="mt-1 text-[13px] text-soft">Please confirm the following to complete your booking.</p>
          <div className="mt-3 flex flex-col gap-3">
            <Checkbox checked={declAge} onChange={(e) => setDeclAge(e.target.checked)}>
              I confirm I will be 18 or over on arrival in resort.
            </Checkbox>
            <Checkbox checked={declFit} onChange={(e) => setDeclFit(e.target.checked)}>
              I am fit to travel and have disclosed any medical or access needs above.
            </Checkbox>
            <Checkbox checked={declTerms} onChange={(e) => setDeclTerms(e.target.checked)}>
              I have read and accept the Booking Conditions, Refund Policy and Trip Terms.
            </Checkbox>
            <Checkbox checked={shareAccessNeeds} onChange={(e) => setShareAccessNeeds(e.target.checked)}>
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
          {error && <p className="mt-2 text-[13px] text-err">{error}</p>}
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
