"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveExtra, saveTier, type ExtraInput } from "@/app/admin/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";

interface Tier { id: string; name: string; price: number; sort_order: number }
interface Extra {
  id: string; type: string; name: string; description: string | null;
  price: number | null; price_tbc: boolean; has_quality_tiers: boolean;
  single_select_group: string | null; sort_order: number; active: boolean;
  extra_tiers: Tier[];
}

// Empty must not become £0.00: a blank price field would otherwise silently save a
// free extra or a free tier (same class as audit #80). NaN is caught before saving.
const toPence = (s: string) => (s.trim() === "" ? NaN : Math.round(parseFloat(s) * 100));
const pounds = (p: number | null) => (p == null ? "" : (p / 100).toFixed(2));

function TierRow({ tripId, extraId, tier }: { tripId: string; extraId: string; tier: Tier }) {
  const router = useRouter();
  const [name, setName] = useState(tier.name);
  const [price, setPrice] = useState(pounds(tier.price));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const pence = toPence(price);
    if (!name.trim()) return setErr("Give the tier a name.");
    if (Number.isNaN(pence)) return setErr("Enter a price for this tier.");
    setBusy(true); setErr(null);
    try {
      const r = await saveTier(tier.id, extraId, tripId, name.trim(), pence, tier.sort_order);
      if (!r.ok) return setErr(r.error);
      router.refresh();
    } catch {
      setErr("Could not save the tier. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-32" />
        <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="w-28" />
        <Button size="sm" variant="out" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {err && <p role="alert" className="text-[13px] text-err">{err}</p>}
    </div>
  );
}

function AddTierRow({ tripId, extraId, nextSortOrder }: { tripId: string; extraId: string; nextSortOrder: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const pence = toPence(price);
    if (!name.trim()) return setErr("Give the tier a name, e.g. Economy.");
    if (Number.isNaN(pence)) return setErr("Enter a price for this tier.");
    setBusy(true); setErr(null);
    try {
      const r = await saveTier(null, extraId, tripId, name.trim(), pence, nextSortOrder);
      if (!r.ok) return setErr(r.error);
      setName(""); setPrice("");
      router.refresh();
    } catch {
      setErr("Could not add the tier. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tier name" className="w-32" />
        <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className="w-28" />
        <Button size="sm" variant="out" onClick={add} disabled={busy}>
          {busy ? "Adding…" : "+ Add tier"}
        </Button>
      </div>
      {err && <p role="alert" className="text-[13px] text-err">{err}</p>}
    </div>
  );
}

function ExtraCard({ tripId, extra, onSaved }: { tripId: string; extra: Extra | null; onSaved?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    type: extra?.type ?? "event",
    name: extra?.name ?? "",
    description: extra?.description ?? "",
    price: pounds(extra?.price ?? null),
    price_tbc: extra?.price_tbc ?? false,
    has_quality_tiers: extra?.has_quality_tiers ?? false,
    single_select_group: extra?.single_select_group ?? "",
    sort_order: String(extra?.sort_order ?? 99),
    active: extra?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const tiers = extra?.extra_tiers ?? [];
  const priceless = f.price_tbc || f.has_quality_tiers;
  // Ticking "has quality tiers" nulls the extra's own price, so an extra with the
  // box on and no tier rows advertises "from £0" and is refused at checkout with
  // "Choose a quality level" (audit #97). Show the tier editor as soon as the box
  // is ticked so the tiers can be added, and refuse to save the unbookable state.
  const showTiers = extra !== null && (f.has_quality_tiers || tiers.length > 0);

  async function save() {
    const pence = toPence(f.price);
    if (!f.name.trim()) return setErr("Give the extra a name.");
    if (!priceless && Number.isNaN(pence)) return setErr("Enter a price, or tick Price TBC.");
    if (f.has_quality_tiers && tiers.length === 0) {
      return setErr(
        extra
          ? "Add at least one quality tier below before saving with tiers on, or nobody can book this extra."
          : "Save the extra first, then tick quality tiers and add them.",
      );
    }
    setBusy(true); setErr(null);
    const input: ExtraInput = {
      type: f.type as ExtraInput["type"],
      name: f.name.trim(),
      description: f.description || null,
      price: priceless ? null : pence,
      price_tbc: f.price_tbc,
      has_quality_tiers: f.has_quality_tiers,
      single_select_group: f.single_select_group || null,
      sort_order: parseInt(f.sort_order || "99", 10),
      active: f.active,
    };
    try {
      const r = await saveExtra(extra?.id ?? null, tripId, input);
      if (!r.ok) return setErr(r.error);
      router.refresh();
      onSaved?.(); // collapse the add-card so a new extra doesn't render twice
    } catch {
      setErr("Could not save the extra. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <Select value={f.type} onChange={(e) => set("type", e.target.value)}>
            {["transport", "equipment", "lessons", "event", "other"].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Sort order"><Input type="number" value={f.sort_order} onChange={(e) => set("sort_order", e.target.value)} /></Field>
        <Field label="Price (£)"><Input type="number" step="0.01" min="0" value={f.price} onChange={(e) => set("price", e.target.value)} disabled={priceless} /></Field>
      </div>
      <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label="Single-select group (e.g. equipment_rental)"><Input value={f.single_select_group} onChange={(e) => set("single_select_group", e.target.value)} /></Field>
      <div className="flex flex-wrap gap-4">
        <Checkbox checked={f.price_tbc} onChange={(e) => set("price_tbc", e.target.checked)}>Price TBC</Checkbox>
        <Checkbox checked={f.has_quality_tiers} onChange={(e) => set("has_quality_tiers", e.target.checked)}>Has quality tiers</Checkbox>
        <Checkbox checked={f.active} onChange={(e) => set("active", e.target.checked)}>Active</Checkbox>
      </div>
      {err && <p role="alert" className="text-[13px] text-err">{err}</p>}
      <div><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : extra ? "Save extra" : "Add extra"}</Button></div>

      {showTiers && extra && (
        <div className="border-t border-line pt-3">
          <div className="mb-2 text-[13px] font-semibold">Quality tiers</div>
          <div className="flex flex-col gap-2">
            {tiers.map((t) => <TierRow key={t.id} tripId={tripId} extraId={extra.id} tier={t} />)}
            <AddTierRow tripId={tripId} extraId={extra.id} nextSortOrder={tiers.reduce((max, t) => Math.max(max, t.sort_order), 0) + 1} />
          </div>
          {tiers.length === 0 && (
            <p className="mt-2 text-[13px] text-soft">Add the tiers first, then save the extra with quality tiers on.</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function ExtrasManager({ tripId, extras }: { tripId: string; extras: Extra[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {extras.map((e) => <ExtraCard key={e.id} tripId={tripId} extra={e} />)}
      {adding ? (
        <ExtraCard tripId={tripId} extra={null} onSaved={() => setAdding(false)} />
      ) : (
        <Button variant="out" onClick={() => setAdding(true)}>+ Add an extra</Button>
      )}
    </div>
  );
}
