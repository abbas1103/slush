"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateExtras, type ExtrasSelectionInput } from "@/app/(booking)/book/actions";
import type { Pricing } from "@/lib/pricing/compute";
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

/** True when the server would refuse this extra: a tiered package with no tier
 *  rows to choose from, or a flat extra with no confirmed price (the same rules
 *  updateExtras applies). Offered as "coming soon" rather than selectable, so a
 *  student can't get stuck on a choice that can never be saved (audit #126). */
function isUnbookable(e: UiExtra): boolean {
  return e.hasTiers ? e.tiers.length === 0 : e.priceTbc || e.price == null;
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
    // Stacks below sm: the name and description get the full width, with the
    // price and button on their own row underneath (audit #88).
    <div className="flex flex-col gap-2.5 rounded-btn border border-line p-3.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <span className="text-[18px]">{icon}</span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ink">{title}</div>
          {desc && <div className="text-[13px] text-soft">{desc}</div>}
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
        <div className="shrink-0 text-right text-[14px] font-semibold">{price}</div>
        <Button
          size="sm"
          variant={added ? "dark" : "out"}
          onClick={onToggle}
          disabled={disabled}
        >
          {added ? "✓ Added" : "+ Add"}
        </Button>
      </div>
    </div>
  );
}

function initialSelection({
  coach,
  equipment,
  lessons,
  events,
  initialSelectedIds,
  initialTiers,
}: Props): Selection {
  const equip = equipment.find((e) => initialSelectedIds.includes(e.id))?.id ?? null;
  return {
    coach: !!coach && initialSelectedIds.includes(coach.id),
    equip,
    tier: equip ? (initialTiers[equip] ?? null) : null,
    lessons: !!lessons && initialSelectedIds.includes(lessons.id),
    events: events.filter((e) => initialSelectedIds.includes(e.id)).map((e) => e.id),
  };
}

export function ExtrasFlow(props: Props) {
  const router = useRouter();
  const { bookingId, coach, equipment, lessons, events } = props;
  const [saving, startSaving] = useTransition();
  const [navigating, startNavigating] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<Pricing>(props.initialPricing);

  // `saved` is the selection the server has confirmed; `sel` is what's on screen.
  // The optimistic value is dropped when the save settles, so a failed
  // updateExtras can never leave a phantom "✓ Added" tick on a row the database
  // doesn't have - the screen always ends up matching what we'll be charging
  // for (audit #30).
  const [saved, setSaved] = useState<Selection>(() => initialSelection(props));
  const [sel, showOptimistic] = useOptimistic(saved);

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
    setError(null);
    startSaving(async () => {
      showOptimistic(next);
      try {
        const r = await updateExtras(bookingId, buildInput(next));
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setSaved(next);
        setPricing(r.pricing);
      } catch {
        // A dropped request mustn't read as a saved change either.
        setError("Couldn't save that change - please check your connection and try again.");
      }
    });
  }

  function pickEquip(id: string | null) {
    const ex = id ? equipment.find((e) => e.id === id) : null;
    const tier = ex?.hasTiers ? (ex.tiers[0]?.id ?? null) : null;
    commit({ ...sel, equip: id, tier });
  }

  const selectedEquip = sel.equip ? equipment.find((e) => e.id === sel.equip) : null;
  const coachUnbookable = !!coach && isUnbookable(coach);
  const lessonsUnbookable = !!lessons && isUnbookable(lessons);

  // Why Continue is held back, if it is. A tiered package needs a level chosen;
  // one with no levels at all can never be saved, so say that instead of
  // pointing at an empty grid (audit #126).
  const blockedNote =
    selectedEquip && selectedEquip.hasTiers && !sel.tier
      ? selectedEquip.tiers.length === 0
        ? `${selectedEquip.name} isn't bookable yet - pick another option to continue.`
        : `Choose a quality level for ${selectedEquip.name} to continue.`
      : null;

  return (
    <div className="mx-auto grid max-w-[1120px] gap-8 px-6 py-8 xl:grid-cols-[1fr_360px]">
      <div>
        <h1>Add your extras</h1>
        <p className="mt-2 text-[15px] text-soft">
          Coach, kit, lessons and events for your place - add what you want, skip
          what you don&apos;t.
        </p>

        {coach && (
          <Card className="mt-5">
            <h3>Getting there</h3>
            <p className="mb-3 mt-1 text-[13px] text-soft">Optional coach from Birmingham to resort.</p>
            <AddRow
              icon="🚌"
              title={coach.name}
              desc={coachUnbookable ? "Details coming soon" : coach.description}
              price={coachUnbookable ? "TBC" : <Money pence={coach.price ?? 0} stripZeros />}
              added={sel.coach}
              disabled={coachUnbookable}
              onToggle={() => commit({ ...sel, coach: !sel.coach })}
            />
          </Card>
        )}

        {equipment.length > 0 && (
          <Card className="mt-4">
            <h3>Equipment rental</h3>
            <p className="mb-3 mt-1 text-[13px] text-soft">Optional - pick a package.</p>
            <div className="flex flex-col gap-2.5">
              <OptionRow
                title="No equipment rental"
                price={<Money pence={0} stripZeros />}
                selected={!sel.equip}
                onClick={() => pickEquip(null)}
              />
              {equipment.map((e) => {
                const unbookable = isUnbookable(e);
                return (
                  <div key={e.id}>
                    <OptionRow
                      title={e.name}
                      desc={unbookable ? "Coming soon" : e.description}
                      price={
                        unbookable ? (
                          "TBC"
                        ) : e.hasTiers ? (
                          <>from <Money pence={e.tiers[0]?.price ?? 0} stripZeros /></>
                        ) : (
                          <Money pence={e.price ?? 0} stripZeros />
                        )
                      }
                      selected={sel.equip === e.id}
                      disabled={unbookable}
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
                );
              })}
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
              desc={lessonsUnbookable ? "Details coming soon" : lessons.description}
              price={lessonsUnbookable ? "TBC" : <Money pence={lessons.price ?? 0} stripZeros />}
              added={sel.lessons}
              disabled={lessonsUnbookable}
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
                const unbookable = isUnbookable(ev);
                return (
                  <AddRow
                    key={ev.id}
                    icon={unbookable ? "★" : "🎟"}
                    title={ev.name}
                    desc={unbookable ? "Details coming soon" : ev.description}
                    price={unbookable ? "TBC" : <Money pence={ev.price ?? 0} stripZeros />}
                    added={on}
                    disabled={unbookable}
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
          {error && (
            <p role="alert" className="mt-2 rounded-btn bg-errbg px-3 py-2 text-[13px] text-err">
              {error}
            </p>
          )}
          <Button
            className="mt-3 w-full"
            disabled={saving || navigating || blockedNote !== null}
            onClick={() => startNavigating(() => router.push(`/book/${bookingId}/details`))}
          >
            {saving ? "Updating…" : navigating ? "Loading…" : "Continue to your details →"}
          </Button>
          {blockedNote && (
            <p className="mt-2 text-center text-[12px] text-soft">{blockedNote}</p>
          )}
        </SummarySidebar>
      </aside>
    </div>
  );
}
