"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateExtras, type ExtrasSelectionInput } from "@/app/(booking)/book/actions";
import { computePricing, type Pricing } from "@/lib/pricing/compute";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { OptionRow } from "@/components/ui/OptionRow";
import { Money } from "@/components/ui/Money";
import { SummarySidebar } from "./SummarySidebar";

export interface UiExtra {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  priceTbc: boolean;
  hasTiers: boolean;
  tiers: { id: string; name: string; price: number }[];
}

interface Selection {
  coach: boolean;
  equip: string | null;
  tier: string | null;
  lessons: boolean;
  events: string[];
}

interface Props {
  bookingId: string;
  tripName: string;
  tripMeta: string;
  coach: UiExtra | null;
  equipment: UiExtra[];
  lessons: UiExtra | null;
  events: UiExtra[];
  initialSelectedIds: string[];
  initialTiers: Record<string, string>;
  initialPricing: Pricing;
}

function AddRow({
  icon,
  title,
  desc,
  price,
  added,
  onToggle,
  disabled,
}: {
  icon: string;
  title: string;
  desc?: string | null;
  price: React.ReactNode;
  added: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-btn border border-line p-3.5">
      <span className="text-[18px]">{icon}</span>
      <div className="flex-1">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {desc && <div className="text-[13px] text-soft">{desc}</div>}
      </div>
      <div className="text-right text-[14px] font-semibold">{price}</div>
      <Button
        size="sm"
        variant={added ? "dark" : "out"}
        onClick={onToggle}
        disabled={disabled}
      >
        {added ? "✓ Added" : "+ Add"}
      </Button>
    </div>
  );
}

export function ExtrasFlow(props: Props) {
  const router = useRouter();
  const { bookingId, coach, equipment, lessons, events } = props;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<Pricing>(props.initialPricing);

  const [sel, setSel] = useState<Selection>(() => {
    const equip = equipment.find((e) => props.initialSelectedIds.includes(e.id))?.id ?? null;
    return {
      coach: !!coach && props.initialSelectedIds.includes(coach.id),
      equip,
      tier: equip ? (props.initialTiers[equip] ?? null) : null,
      lessons: !!lessons && props.initialSelectedIds.includes(lessons.id),
      events: events.filter((e) => props.initialSelectedIds.includes(e.id)).map((e) => e.id),
    };
  });

  function buildInput(next: Selection): ExtrasSelectionInput {
    const ids: string[] = [];
    if (next.coach && coach) ids.push(coach.id);
    if (next.equip) ids.push(next.equip);
    if (next.lessons && lessons) ids.push(lessons.id);
    ids.push(...next.events);
    const tiers: Record<string, string> = {};
    if (next.equip && next.tier) tiers[next.equip] = next.tier;
    return { extraIds: ids, tiers };
  }

  function commit(next: Selection) {
    setSel(next);
    setError(null);
    startTransition(async () => {
      const r = await updateExtras(bookingId, buildInput(next));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setPricing(r.pricing);
    });
  }

  function pickEquip(id: string | null) {
    const ex = id ? equipment.find((e) => e.id === id) : null;
    const tier = ex?.hasTiers ? (ex.tiers[0]?.id ?? null) : null;
    commit({ ...sel, equip: id, tier });
  }

  const selectedEquip = sel.equip ? equipment.find((e) => e.id === sel.equip) : null;

  return (
    <div className="mx-auto grid max-w-[1120px] gap-8 px-6 py-8 xl:grid-cols-[1fr_360px]">
      <div>
        <h1>Add your extras</h1>
        <p className="mt-2 text-[15px] text-soft">
          Coach, kit, lessons and events for your place — add what you want, skip
          what you don&apos;t.
        </p>

        {coach && (
          <Card className="mt-5">
            <h3>Getting there</h3>
            <p className="mb-3 mt-1 text-[13px] text-soft">Optional coach from Birmingham to resort.</p>
            <AddRow
              icon="🚌"
              title={coach.name}
              desc={coach.description}
              price={<Money pence={coach.price ?? 0} stripZeros />}
              added={sel.coach}
              onToggle={() => commit({ ...sel, coach: !sel.coach })}
            />
          </Card>
        )}

        {equipment.length > 0 && (
          <Card className="mt-4">
            <h3>Equipment rental</h3>
            <p className="mb-3 mt-1 text-[13px] text-soft">Optional — pick a package.</p>
            <div className="flex flex-col gap-2.5">
              <OptionRow
                title="No equipment rental"
                price={<Money pence={0} stripZeros />}
                selected={!sel.equip}
                onClick={() => pickEquip(null)}
              />
              {equipment.map((e) => (
                <div key={e.id}>
                  <OptionRow
                    title={e.name}
                    desc={e.description}
                    price={
                      e.hasTiers ? (
                        <>from <Money pence={e.tiers[0]?.price ?? 0} stripZeros /></>
                      ) : (
                        <Money pence={e.price ?? 0} stripZeros />
                      )
                    }
                    selected={sel.equip === e.id}
                    onClick={() => pickEquip(e.id)}
                  />
                  {sel.equip === e.id && e.hasTiers && (
                    <div className="mt-2 grid grid-cols-2 gap-2 pl-3">
                      {e.tiers.map((t) => (
                        <OptionRow
                          key={t.id}
                          title={t.name}
                          price={<Money pence={t.price} stripZeros />}
                          selected={sel.tier === t.id}
                          onClick={() => commit({ ...sel, tier: t.id })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {lessons && (
          <Card className="mt-4">
            <h3>Lessons</h3>
            <p className="mb-3 mt-1 text-[13px] text-soft">Optional group lessons.</p>
            <AddRow
              icon="🎿"
              title={lessons.name}
              desc={lessons.description}
              price={<Money pence={lessons.price ?? 0} stripZeros />}
              added={sel.lessons}
              onToggle={() => commit({ ...sel, lessons: !sel.lessons })}
            />
          </Card>
        )}

        {events.length > 0 && (
          <Card className="mt-4">
            <h3>Events</h3>
            <p className="mb-3 mt-1 text-[13px] text-soft">Add the nights you fancy.</p>
            <div className="flex flex-col gap-2.5">
              {events.map((ev) => {
                const on = sel.events.includes(ev.id);
                return (
                  <AddRow
                    key={ev.id}
                    icon={ev.priceTbc ? "★" : "🎟"}
                    title={ev.name}
                    desc={ev.priceTbc ? "Details coming soon" : ev.description}
                    price={ev.priceTbc ? "TBC" : <Money pence={ev.price ?? 0} stripZeros />}
                    added={on}
                    disabled={ev.priceTbc}
                    onToggle={() =>
                      commit({
                        ...sel,
                        events: on
                          ? sel.events.filter((x) => x !== ev.id)
                          : [...sel.events, ev.id],
                      })
                    }
                  />
                );
              })}
            </div>
          </Card>
        )}
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start">
        <SummarySidebar pricing={pricing} tripName={props.tripName} tripMeta={props.tripMeta}>
          <div className="mt-3 rounded-btn bg-soft-panel px-3 py-2 text-center text-[13px] text-ink-2">
            🔒 Pay <Money pence={pricing.depositToday} stripZeros /> deposit today
          </div>
          {error && <p className="mt-2 text-[13px] text-err">{error}</p>}
          <Button
            className="mt-3 w-full"
            disabled={pending || !!selectedEquip?.hasTiers && !sel.tier}
            onClick={() => router.push(`/book/${bookingId}/details`)}
          >
            {pending ? "Updating…" : "Continue to your details →"}
          </Button>
        </SummarySidebar>
      </aside>
    </div>
  );
}
