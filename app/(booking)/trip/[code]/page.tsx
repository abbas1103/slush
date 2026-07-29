import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { getTripByCode } from "@/lib/db/queries";
import { FlowBar } from "@/components/chrome/FlowBar";
import { TripTabs } from "@/components/booking/TripTabs";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Money } from "@/components/ui/Money";
import { formatDate, formatDateRange } from "@/lib/utils/dates";
import { BookButton } from "@/components/booking/BookButton";

/** One trip read per request, shared by generateMetadata and the page. */
const loadTrip = cache(getTripByCode);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const detail = await loadTrip(decodeURIComponent(code));
  // The whole booking flow sits behind requireUser, so noindex is belt-and-braces.
  // The title is what stops three open booking tabs looking identical.
  const robots = { index: false, follow: false };
  if (!detail) return { title: "Your trip - SLUSH", robots };
  return {
    title: `${detail.trip.name} - SLUSH`,
    description: detail.trip.description ?? undefined,
    robots,
  };
}

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const tripCode = decodeURIComponent(code);
  const detail = await loadTrip(tripCode);
  if (!detail) notFound();

  const { trip, extras, isFull } = detail;
  const events = extras.filter((e) => e.type === "event");
  const coach = extras.find((e) => e.type === "transport");
  const inclusions = Array.isArray(trip.base_inclusions)
    ? (trip.base_inclusions as string[])
    : [];
  const dateRange = formatDateRange(trip.start_date, trip.end_date);

  // Every row comes from the trips row. Service levels the CMS has no field for
  // (check-in time, in-resort cover) are not promised here, and cancellation
  // points at the booking conditions rather than restating a policy.
  const goodToKnow: [string, ReactNode][] = [
    ["Resort", `${trip.resort}, ${trip.country}`],
    ["Dates", `${dateRange} · ${trip.nights} nights`],
    ["Deposit", <Money key="deposit" pence={trip.deposit_amount} stripZeros />],
    [
      "Balance due",
      trip.balance_due_date ? formatDate(trip.balance_due_date) : "Before you travel",
    ],
    [
      "Cancellation",
      // #cancellations, not #booking: the latter is "Booking & payment", so the
      // Cancellation row was linking a student to the wrong section.
      <Link key="cancellation" href="/terms#cancellations" className="underline hover:no-underline">
        Cancellations &amp; refunds
      </Link>,
    ],
    ["Trip run by", `${trip.organiser}, via SLUSH`],
    // saveDetails hard-rejects anyone under 18 on the arrival date, so a student
    // can otherwise reach the details step, fill in a passport number and only
    // then be refused. This is the one place they see it before committing.
    ["Age", "18+ on arrival in resort"],
  ];

  return (
    <>
      <FlowBar step={0} backHref="/trip" backLabel="Back to trip search" />

      <div className="mx-auto grid max-w-[1120px] gap-8 px-6 py-8 xl:grid-cols-[1fr_360px]">
        {/* ── Left column ─────────────────────────────────────────── */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1>{trip.name}</h1>
            <Pill variant="black">Official trip</Pill>
            {isFull ? (
              <Pill variant="error" dot>
                Trip full · waiting list open
              </Pill>
            ) : (
              <Pill variant="success" dot>
                Booking live
              </Pill>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[14px] text-soft">
            <span>{trip.organiser}</span>
            <span>· 📍 {trip.resort}</span>
            <span>· 📅 {dateRange}</span>
          </div>

          <div className="mt-6">
            <TripTabs />
          </div>

          <section id="overview" className="scroll-mt-24 border-b border-line py-6">
            <h3>The lowdown</h3>
            <p className="mt-2 text-[15px] text-ink-2">{trip.description}</p>
          </section>

          <section id="included" className="scroll-mt-24 border-b border-line py-6">
            <h3>What&apos;s included</h3>
            <Card className="mt-3" tone="surface">
              <div className="text-[13px] font-semibold text-ink">● In your ticket</div>
              <ul className="mt-3 flex flex-col gap-2 text-[14px] text-ink-2">
                {inclusions.map((item) => (
                  <li key={item}>✓&nbsp; {item}</li>
                ))}
              </ul>
            </Card>
          </section>

          <section id="lineup" className="scroll-mt-24 border-b border-line py-6">
            <h3>The line-up</h3>
            <p className="mt-1 text-[14px] text-soft">
              Events across the week - all bookable as extras.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {events.map((ev) => (
                <Card key={ev.id} padding="sm">
                  <div className="text-[15px]">{ev.price_tbc ? "★" : "♪"}</div>
                  <div className="mt-1 text-[14px] font-semibold text-ink">{ev.name}</div>
                  <div className="text-[12.5px] text-soft">
                    {ev.price_tbc ? "Price TBC" : <Money pence={ev.price ?? 0} stripZeros />}
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <section id="stay" className="scroll-mt-24 border-b border-line py-6">
            <h3>Where you&apos;ll stay</h3>
            <p className="mt-2 text-[14px] text-ink-2">
              {trip.nights} nights in {trip.resort}, {trip.country} ({dateRange}).
            </p>
            <p className="mt-1 text-[12.5px] text-soft">
              Your accommodation is arranged by {trip.organiser} and is listed in
              what&apos;s included above.
            </p>
          </section>

          <section id="location" className="scroll-mt-24 py-6">
            <h3>Good to know</h3>
            <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {goodToKnow.map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-4 border-b border-line-2 py-2 text-[14px]"
                >
                  <span className="text-soft">{k}</span>
                  <span className="text-right text-ink">{v}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ── Sticky booking sidebar ──────────────────────────────── */}
        <aside className="flex flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <div className="text-[13px] text-soft">
              Your place · {trip.nights} nights · 1 person
            </div>
            <div className="mt-1 text-[34px] font-extrabold leading-none">
              <Money pence={trip.base_price} stripZeros />{" "}
              <span className="text-[15px] font-medium text-soft">pp</span>
            </div>
            <p className="mt-3 text-[13px] text-soft">
              {inclusions.length > 0
                ? `Includes ${inclusions.join(", ").toLowerCase()}.`
                : "Includes your place on the trip."}
            </p>

            <div className="mt-4">
              {isFull ? (
                <>
                  <div className="rounded-btn bg-errbg px-3 py-2 text-[13px] font-semibold text-err">
                    ● This trip is full
                  </div>
                  <p className="mt-2 text-[13px] text-soft">
                    Join the waiting list - pay your <Money pence={trip.deposit_amount} stripZeros />{" "}
                    deposit to hold a spot. If a place opens up you&apos;re on the
                    trip; if not, we refund it in full.
                  </p>
                </>
              ) : (
                <div className="rounded-btn bg-soft-panel px-3 py-2 text-[13px] text-ink-2">
                  🔒 Secure your place with a <Money pence={trip.deposit_amount} stripZeros /> deposit
                </div>
              )}
              <BookButton code={tripCode} isFull={isFull} />
              <p className="mt-2 text-center text-[12px] text-soft">
                One place per booking ·{" "}
                <Link href="/terms#booking" className="underline hover:no-underline">
                  Booking conditions
                </Link>
              </p>
            </div>
          </Card>

          {coach && (
            <Card padding="sm">
              <div className="text-[13px] font-semibold text-ink">Getting there</div>
              <p className="mt-1 text-[13px] text-soft">
                {coach.description ?? "Optional coach to resort"} is available as
                an optional extra ({<Money pence={coach.price ?? 0} stripZeros />})
                - or make your own way to resort.
              </p>
            </Card>
          )}

          <Card padding="sm">
            <div className="text-[13px] font-semibold text-ink">Booking for your group?</div>
            <p className="mt-1 text-[13px] text-soft">
              Everyone books individually with the same trip code - share it with
              your group so you&apos;re all on the same trip.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
