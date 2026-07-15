"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTrip, type TripInput } from "@/app/admin/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

export interface TripFormInitial extends Omit<TripInput, "base_price" | "deposit_amount" | "downpayment_amount" | "damage_deposit_amount" | "base_inclusions"> {
  base_price: number;
  deposit_amount: number;
  downpayment_amount: number;
  damage_deposit_amount: number;
  base_inclusions: string[];
}

const money = (pence: number) => (pence / 100).toFixed(2);
const toPence = (s: string) => Math.round(parseFloat(s || "0") * 100);

export function TripForm({ tripId, initial }: { tripId: string | null; initial: TripFormInitial }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: initial.name,
    organiser: initial.organiser,
    resort: initial.resort,
    country: initial.country,
    start_date: initial.start_date,
    end_date: initial.end_date,
    nights: String(initial.nights),
    base_price: money(initial.base_price),
    base_inclusions: initial.base_inclusions.join("\n"),
    deposit_amount: money(initial.deposit_amount),
    downpayment_amount: money(initial.downpayment_amount),
    damage_deposit_amount: money(initial.damage_deposit_amount),
    balance_due_date: initial.balance_due_date ?? "",
    capacity: String(initial.capacity),
    description: initial.description,
    status: initial.status,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const splitOk = toPence(f.downpayment_amount) + toPence(f.damage_deposit_amount) === toPence(f.deposit_amount);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!splitOk) {
      setError("Downpayment + damage deposit must equal the total deposit.");
      return;
    }
    setSaving(true);
    const input: TripInput = {
      name: f.name,
      organiser: f.organiser,
      resort: f.resort,
      country: f.country,
      start_date: f.start_date,
      end_date: f.end_date,
      nights: parseInt(f.nights || "0", 10),
      base_price: toPence(f.base_price),
      base_inclusions: f.base_inclusions.split("\n").map((s) => s.trim()).filter(Boolean),
      deposit_amount: toPence(f.deposit_amount),
      downpayment_amount: toPence(f.downpayment_amount),
      damage_deposit_amount: toPence(f.damage_deposit_amount),
      balance_due_date: f.balance_due_date || null,
      capacity: parseInt(f.capacity || "0", 10),
      description: f.description,
      status: f.status as TripInput["status"],
    };
    const r = await saveTrip(tripId, input);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (!tripId) router.push(`/admin/trips/${r.id}`);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trip name"><Input value={f.name} onChange={set("name")} required /></Field>
          <Field label="Organiser / society"><Input value={f.organiser} onChange={set("organiser")} required /></Field>
          <Field label="Resort"><Input value={f.resort} onChange={set("resort")} required /></Field>
          <Field label="Country"><Input value={f.country} onChange={set("country")} required /></Field>
          <Field label="Start date"><Input type="date" value={f.start_date} onChange={set("start_date")} required /></Field>
          <Field label="End date"><Input type="date" value={f.end_date} onChange={set("end_date")} required /></Field>
          <Field label="Nights"><Input type="number" value={f.nights} onChange={set("nights")} /></Field>
          <Field label="Capacity"><Input type="number" value={f.capacity} onChange={set("capacity")} /></Field>
        </div>
        <Field label="Base price (£ pp)"><Input type="number" step="0.01" value={f.base_price} onChange={set("base_price")} /></Field>
        <Field label="What's included (one per line)"><Textarea rows={3} value={f.base_inclusions} onChange={set("base_inclusions")} /></Field>
        <Field label="Description"><Textarea rows={3} value={f.description} onChange={set("description")} /></Field>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="text-[13px] font-semibold">Deposit split</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Total deposit (£)"><Input type="number" step="0.01" value={f.deposit_amount} onChange={set("deposit_amount")} /></Field>
          <Field label="Downpayment (£, → trip)"><Input type="number" step="0.01" value={f.downpayment_amount} onChange={set("downpayment_amount")} /></Field>
          <Field label="Damage deposit (£, refundable)"><Input type="number" step="0.01" value={f.damage_deposit_amount} onChange={set("damage_deposit_amount")} /></Field>
        </div>
        {!splitOk && <p className="text-[13px] text-err">Downpayment + damage deposit must equal the total deposit.</p>}
        <Field label="Balance due date"><Input type="date" value={f.balance_due_date} onChange={set("balance_due_date")} /></Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")}>
            <option value="draft">Draft</option>
            <option value="live">Live</option>
            <option value="closed">Closed</option>
          </Select>
        </Field>
      </Card>

      {error && <p className="text-[13px] text-err">{error}</p>}
      {saved && <p className="text-[13px] text-ok">Saved.</p>}
      <div>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : tripId ? "Save changes" : "Create trip"}</Button>
      </div>
    </form>
  );
}
