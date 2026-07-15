import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computePricing } from "@/lib/pricing/compute";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Money } from "@/components/ui/Money";
import { Timeline } from "@/components/ui/Timeline";
import { buttonVariants } from "@/components/ui/Button";
import { StatusPoller } from "@/components/booking/StatusPoller";
import { PaymentReturn } from "@/components/booking/PaymentReturn";
import { formatDate, formatDateRange } from "@/lib/utils/dates";

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, reference, trip_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) notFound();

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", booking.trip_id)
    .maybeSingle();
  if (!trip) notFound();

  const { data: bes } = await supabase
    .from("booking_extras")
    .select("price_at_booking, quantity")
    .eq("booking_id", bookingId);
  const { data: payments } = await supabase
    .from("payments")
    .select("type, amount, status")
    .eq("booking_id", bookingId);

  const pricing = computePricing({
    basePrice: trip.base_price,
    depositAmount: trip.deposit_amount,
    downpaymentAmount: trip.downpayment_amount,
    damageDepositAmount: trip.damage_deposit_amount,
    extras: (bes ?? []).map((b) => ({ label: "", amount: b.price_at_booking * b.quantity })),
  });
  const paidToTrip = (payments ?? [])
    .filter((p) => p.status === "succeeded" && (p.type === "deposit" || p.type === "balance"))
    .reduce((sum, p) => sum + p.amount, 0);
  const balance = pricing.tripCost - paidToTrip;
  const damageHeld = (payments ?? []).some((p) => p.type === "damage_deposit_hold" && p.status === "succeeded");

  const isPending = booking.status === "pending";
  const isWaitlist = booking.status === "waitlisted";

  return (
    <div className="mx-auto max-w-[1120px] px-6 py-10">
      <PaymentReturn bookingId={bookingId} />
      {isPending && <StatusPoller />}

      <div className="rounded-card bg-panel p-8 text-center text-white">
        {isPending ? (
          <>
            <h1 className="text-white">Processing your payment…</h1>
            <p className="mt-2 text-white/70">
              Confirming with your bank — this usually takes a few seconds. This
              page will update automatically.
            </p>
          </>
        ) : isWaitlist ? (
          <>
            <h1 className="text-white">You&apos;re on the waiting list ⏳</h1>
            <p className="mt-2 text-white/70">
              You&apos;ve secured a waiting-list spot for {trip.name}. If a place opens up
              we&apos;ll confirm you and email you — if not, we refund your deposit in full.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-white">Your place is booked! 🎉</h1>
            <p className="mt-2 text-white/70">You&apos;re going on the {trip.name}.</p>
          </>
        )}
        {!isPending && (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {[
              ["Booking reference", booking.reference],
              ["Resort", trip.resort],
              ["Departure", formatDate(trip.start_date)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-btn bg-white/10 px-4 py-2 text-left">
                <div className="text-[11px] uppercase tracking-wide text-white/50">{k}</div>
                <div className="text-[14px] font-semibold">{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isPending && (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
          <Card padding="lg">
            <div className="flex items-center justify-between">
              <h3 className="text-[17px]">Payment</h3>
              <Pill variant={isWaitlist ? "error" : "success"} dot>
                {isWaitlist ? "On the waiting list" : "Deposit paid"}
              </Pill>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-[12.5px] text-soft">Paid to trip</div>
                <div className="text-[22px] font-extrabold"><Money pence={paidToTrip} /></div>
              </div>
              <div>
                <div className="text-[12.5px] text-soft">Balance remaining</div>
                <div className="text-[22px] font-extrabold"><Money pence={balance} /></div>
              </div>
              <div>
                <div className="text-[12.5px] text-soft">Pay by</div>
                <div className="text-[22px] font-extrabold">{formatDate(trip.balance_due_date)}</div>
              </div>
            </div>
            {damageHeld && (
              <p className="mt-3 text-[12.5px] text-soft">
                <Money pence={trip.damage_deposit_amount} stripZeros /> refundable damage deposit held —
                returned to your card after the trip.
              </p>
            )}
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="mb-2">What happens next</h3>
              <Timeline
                items={[
                  { title: "Now", desc: "Your place is reserved and your confirmation is on its way.", now: true },
                  { title: "Any time", desc: `Pay off your balance before ${formatDate(trip.balance_due_date)}.` },
                  { title: "7 days before", desc: "Your lift pass and event tickets unlock in the app." },
                ]}
              />
            </div>
          </Card>

          <aside className="flex flex-col gap-3">
            <Link href="/" className={buttonVariants({ variant: "dark", pill: true }) + " w-full"}>
              ⊞ Go to my dashboard
            </Link>
            <Card padding="sm">
              <div className="text-[13px] font-semibold">Pay at your own pace</div>
              <p className="mt-1 text-[13px] text-soft">
                Top up your balance any time before {formatDate(trip.balance_due_date)} — in one go or
                bit by bit. (Dashboard &amp; tickets arrive in the next slice.)
              </p>
            </Card>
          </aside>
        </div>
      )}

      <p className="mt-6 text-center text-[12px] text-soft">
        {trip.name} · {formatDateRange(trip.start_date, trip.end_date)}
      </p>
    </div>
  );
}
