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

const toPence = (s: string) => Math.round(parseFloat(s || "0") * 100);
const pounds = (p: number | null) => (p == null ? "" : (p / 100).toFixed(2));

function TierRow({ tripId, extraId, tier }: { tripId: string; extraId: string; tier: Tier }) {
  const router = useRouter();
  const [price, setPrice] = useState(pounds(tier.price));
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 text-[13px]">{tier.name}</span>
      <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-28" />
      <Button size="sm" variant="out" onClick={async () => { await saveTier(tier.id, extraId, tripId, tier.name, toPence(price), tier.sort_order); router.refresh(); }}>
        Save
      </Button>
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

  async function save() {
    setBusy(true); setErr(null);
    const input: ExtraInput = {
      type: f.type as ExtraInput["type"],
      name: f.name,
      description: f.description || null,
      price: f.price_tbc || f.has_quality_tiers ? null : toPence(f.price),
      price_tbc: f.price_tbc,
      has_quality_tiers: f.has_quality_tiers,
      single_select_group: f.single_select_group || null,
      sort_order: parseInt(f.sort_order || "99", 10),
      active: f.active,
    };
    const r = await saveExtra(extra?.id ?? null, tripId, input);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.refresh();
    onSaved?.(); // collapse the add-card so a new extra doesn't render twice
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
        <Field label="Price (£)"><Input type="number" step="0.01" value={f.price} onChange={(e) => set("price", e.target.value)} disabled={f.price_tbc || f.has_quality_tiers} /></Field>
      </div>
      <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label="Single-select group (e.g. equipment_rental)"><Input value={f.single_select_group} onChange={(e) => set("single_select_group", e.target.value)} /></Field>
      <div className="flex flex-wrap gap-4">
        <Checkbox checked={f.price_tbc} onChange={(e) => set("price_tbc", e.target.checked)}>Price TBC</Checkbox>
        <Checkbox checked={f.has_quality_tiers} onChange={(e) => set("has_quality_tiers", e.target.checked)}>Has quality tiers</Checkbox>
        <Checkbox checked={f.active} onChange={(e) => set("active", e.target.checked)}>Active</Checkbox>
      </div>
      {err && <p className="text-[13px] text-err">{err}</p>}
      <div><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : extra ? "Save extra" : "Add extra"}</Button></div>

      {extra?.has_quality_tiers && (
        <div className="border-t border-line pt-3">
          <div className="mb-2 text-[13px] font-semibold">Quality tiers</div>
          <div className="flex flex-col gap-2">
            {extra.extra_tiers.map((t) => <TierRow key={t.id} tripId={tripId} extraId={extra.id} tier={t} />)}
          </div>
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
