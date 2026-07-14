"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Stepper } from "@/components/ui/Stepper";
import { OptionRow } from "@/components/ui/OptionRow";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { MetricTile } from "@/components/ui/MetricTile";
import { Timeline } from "@/components/ui/Timeline";
import { Modal } from "@/components/ui/Modal";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-soft">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

export default function ComponentsPreview() {
  const [equip, setEquip] = useState("none");
  const [terms, setTerms] = useState(true);
  const [step, setStep] = useState(2);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-12">
      <header>
        <h1>SLUSH component library</h1>
        <p className="mt-1 text-soft">
          Design-system primitives, mirrored from the prototype tokens. Slice 0.
        </p>
      </header>

      <Section title="Buttons">
        <Button>Pay £150 deposit</Button>
        <Button variant="out">Back to trip</Button>
        <Button variant="ghost">Need help?</Button>
        <Button pill>Pill button</Button>
        <Button size="sm" variant="out">
          Small
        </Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section title="Pills">
        <Pill variant="success" dot>
          Booking live
        </Pill>
        <Pill variant="error" dot>
          Trip full · waiting list open
        </Pill>
        <Pill variant="black">Official trip</Pill>
        <Pill variant="tag">7 nights</Pill>
      </Section>

      <Section title="Stepper">
        <div className="flex w-full flex-col gap-3">
          <Stepper
            steps={["Trip", "Extras", "Your details", "Payment"]}
            current={step}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="out" onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Prev
            </Button>
            <Button size="sm" variant="out" onClick={() => setStep((s) => Math.min(3, s + 1))}>
              Next
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Cards">
        <Card className="w-64">
          <h3>Your place · 7 nights</h3>
          <p className="mt-2 text-[13px] text-soft">
            Includes accommodation, lift pass and a trip tee.
          </p>
        </Card>
        <Card tone="dark" className="w-64">
          <h3 className="text-white">Your tickets</h3>
          <p className="mt-2 text-[13px] text-white/70">
            Unlock once your balance is cleared.
          </p>
        </Card>
      </Section>

      <Section title="Option rows (single-select)">
        <div className="flex w-full flex-col gap-2.5">
          {[
            { k: "none", t: "No equipment rental", d: "Bring your own kit", p: <Money pence={0} /> },
            { k: "sbp", t: "Skis, Boots & Poles", d: "Choose a quality tier", p: "from £79" },
            { k: "sb", t: "Snowboard & Boots", d: "All-in package", p: <Money pence={8900} /> },
          ].map((o) => (
            <OptionRow
              key={o.k}
              title={o.t}
              desc={o.d}
              price={o.p}
              selected={equip === o.k}
              onClick={() => setEquip(o.k)}
            />
          ))}
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="First name(s)">
            <Input defaultValue="Alex" />
          </Field>
          <Field label="Nationality">
            <Select defaultValue="British">
              <option>British</option>
              <option>Other</option>
            </Select>
          </Field>
          <Field label="Passport number" hint="Stored encrypted">
            <Input placeholder="•• ••• •••" />
          </Field>
        </div>
        <Field label="Anything we should know?" className="w-full">
          <Textarea rows={3} placeholder="Medical or access requirements…" />
        </Field>
        <Checkbox
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
        >
          I have read and accept the Booking Conditions, Refund Policy and Trip Terms.
        </Checkbox>
      </Section>

      <Section title="Money & progress">
        <div className="flex w-full flex-col gap-3">
          <div className="flex gap-6 text-[15px]">
            <span>
              Trip total: <Money pence={43900} className="font-bold" />
            </span>
            <span>
              Pay today: <Money pence={15000} stripZeros className="font-bold" />
            </span>
            <span>
              Exposure: <Money pence={4500000} grouped className="font-bold" />
            </span>
          </div>
          <ProgressBar value={11} label="Payment progress" />
        </div>
      </Section>

      <Section title="Metric tiles">
        <div className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile label="Trip total" value={<Money pence={43900} />} sub="All extras included" />
          <MetricTile label="Paid to trip" value={<Money pence={5000} />} sub="Downpayment · 11%" />
          <MetricTile label="Remaining balance" value={<Money pence={38900} />} sub="Pay any time" dark />
          <MetricTile label="Pay by" value="15 Nov 2026" sub="Damage deposit £100 held" />
        </div>
      </Section>

      <Section title="Timeline">
        <Timeline
          items={[
            { title: "Now", desc: "Confirmation emailed — your place is reserved.", now: true },
            { title: "Any time", desc: "Pay off your balance in your dashboard." },
            { title: "7 days before", desc: "Your lift pass & event tickets unlock." },
          ]}
        />
      </Section>

      <Section title="Modal">
        <Button onClick={() => setModalOpen(true)}>Open hold modal</Button>
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} labelledBy="modal-title">
          <h2 id="modal-title">Your place is reserved 🔒</h2>
          <p className="mt-2 text-[14px] text-soft">
            We&apos;re holding your place for the next 30 minutes. Finish your
            booking to secure it.
          </p>
          <div className="mt-5 flex gap-2">
            <Button onClick={() => setModalOpen(false)}>Finish my booking →</Button>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Release my place
            </Button>
          </div>
        </Modal>
      </Section>
    </main>
  );
}
