import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computePricing } from "@/lib/pricing/compute";
import { computePaidToTrip } from "@/lib/db/queries";
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

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, status, reference, trip_id, base_price_at_booking")
    .eq("id", bookingId)
    .maybeSingle();
  // A failed read is not a missing booking - never show a 404 for one, least of
  // all on the screen a student lands on straight after paying.
  if (bookingError) throw new Error(bookingError.message);
  if (!booking) notFound();

  // Everything else only needs the booking, so it goes in one wave.
  const [tripRes, besRes, paymentsRes] = await Promise.all([
    supabase.from("trips").select("*").eq("id", booking.trip_id).maybeSingle(),
    supabase
      .from("booking_extras")
      .select("price_at_booking, quantity")
      .eq("booking_id", bookingId),
    supabase.from("payments").select("type, amount, status").eq("booking_id", bookingId),
  ]);
  if (tripRes.error) throw new Error(tripRes.error.message);
  if (besRes.error) throw new Error(besRes.error.message);
  if (paymentsRes.error) throw new Error(paymentsRes.error.message);
  const trip = tripRes.data;
  if (!trip) notFound();
  const bes = besRes.data;
  const payments = paymentsRes.data;

  const pricing = computePricing({
    // Snapshot, not the live trip price - a later admin price edit must not
    // rewrite the receipt a student was already shown.
    basePrice: booking.base_price_at_booking ?? trip.base_price,
    depositAmount: trip.deposit_amount,
    downpaymentAmount: trip.downpayment_amount,
    damageDepositAmount: trip.damage_deposit_amount,
    extras: (bes ?? []).map((b) => ({ label: "", amount: b.price_at_booking * b.quantity })),
  });
  // One implementation of this, shared with the dashboard and the admin table.
  // The local copy this replaces omitted the waitlist-refund term, so a refunded
  // waitlister was still shown as having paid their downpayment.
  const paidToTrip = computePaidToTrip(payments ?? [], trip.downpayment_amount);
  const balance = pricing.tripCost - paidToTrip;
  const damageHeld = (payments ?? []).some((p) => p.type === "damage_deposit_hold" && p.status === "succeeded");

  const isPending = booking.status === "pending";
  const isWaitlist = booking.status === "waitlisted";
  // Terminal states must never fall through to the success branch. A booking the
  // hold sweep cancelled, or one that has been refunded, was still being told
  // "Your place is booked!" because the branch below was a bare else.
  const isCancelled = booking.status === "cancelled";
  const isRefunded = booking.status === "refunded";
  const isTerminal = isCancelled || isRefunded;

  return (
    <div className="mx-auto max-w-[1120px] px-6 py-10">
      <PaymentReturn bookingId={bookingId} />
      {isPending && <StatusPoller />}

      <div className="rounded-card bg-panel p-8 text-center text-white">
        {isPending ? (
          <>
            <h1 className="text-white">Processing your payment…</h1>
            <p className="mt-2 text-white/70">
              Confirming with your bank - this usually takes a few seconds. This
              page will update automatically.
            </p>
            <p className="mt-4">
              <Link href="/dashboard" className="text-[13px] text-white/80 underline">
                Taking longer than expected? Go to my dashboard →
              </Link>
            </p>
          </>
        ) : isTerminal ? (
          <>
            <h1 className="text-white">
              {isRefunded ? "This booking has been refunded" : "This booking was cancelled"}
            </h1>
            <p className="mt-2 text-white/70">
              {isRefunded
                ? `We've refunded your payment for the ${trip.name}. Refunds usually reach your card within a few working days.`
                : `Your hold on the ${trip.name} expired before payment, so the place was released. You can start again with your trip code.`}
            </p>
            <p className="mt-4">
              <Link href="/dashboard" className="text-[13px] text-white/80 underline">
                Go to my dashboard →
              </Link>
            </p>
          </>
        ) : isWaitlist ? (
          <>
            <h1 className="text-white">You&apos;re on the waiting list ⏳</h1>
            <p className="mt-2 text-white/70">
              You&apos;ve secured a waiting-list spot for {trip.name}. If a place opens up we&apos;ll
              confirm you and your dashboard will show it - if not, we refund your deposit in full.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-white">Your place is booked! 🎉</h1>
            <p className="mt-2 text-white/70">You&apos;re going on the {trip.name}.</p>
          </>
        )}
        {!isPending && !isTerminal && (
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

      {!isPending && !isTerminal && (
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
                <div className="text-[12.5px] text-soft">{isWaitlist ? "Balance due by" : "Pay by"}</div>
                <div className="text-[22px] font-extrabold">{formatDate(trip.balance_due_date)}</div>
              </div>
            </div>
            {isWaitlist && (
              <p className="mt-3 text-[12.5px] text-soft">
                You only owe your balance if a place opens up and we confirm you.
              </p>
            )}
            {damageHeld && (
              <p className="mt-3 text-[12.5px] text-soft">
                <Money pence={trip.damage_deposit_amount} stripZeros /> refundable damage deposit held -{" "}
                {isWaitlist
                  ? "refunded with your deposit if no place opens up."
                  : "returned to your card after the trip."}
              </p>
            )}
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="mb-2">What happens next</h3>
              <Timeline
                items={
                  isWaitlist
                    ? [
                        {
                          title: "Now",
                          desc: `Your deposit is paid and you're in line for a place. Your reference is ${booking.reference}.`,
                          now: true,
                        },
                        {
                          title: "If a place opens up",
                          desc: "We confirm you, your dashboard switches to a confirmed booking, and your balance opens for payment.",
                        },
                        { title: "If one doesn't", desc: "We refund your deposit in full." },
                      ]
                    : [
                        {
                          title: "Now",
                          desc: `Your place is reserved under reference ${booking.reference}. Your dashboard has your booking, your balance and every payment.`,
                          now: true,
                        },
                        {
                          title: "Any time",
                          desc: `Pay off your balance before ${formatDate(trip.balance_due_date)}.`,
                        },
                        {
                          title: "Once your balance is cleared",
                          desc: "Your lift pass and event tickets unlock in the app (or automatically 7 days before travel).",
                        },
                      ]
                }
              />
            </div>
          </Card>

          <aside className="flex flex-col gap-3">
            <Link href="/dashboard" className={buttonVariants({ variant: "dark", pill: true }) + " w-full"}>
              ⊞ Go to my dashboard
            </Link>
            <Card padding="sm">
              {isWaitlist ? (
                <>
                  <div className="text-[13px] font-semibold">Keep an eye on your dashboard</div>
                  <p className="mt-1 text-[13px] text-soft">
                    Your waiting-list place, your reference and every payment are there. We don&apos;t
                    ask for your balance unless a place opens up.
                  </p>
                </>
              ) : (
                <>
                  <div className="text-[13px] font-semibold">Pay at your own pace</div>
                  <p className="mt-1 text-[13px] text-soft">
                    Top up your balance any time before {formatDate(trip.balance_due_date)} - in one go
                    or bit by bit, from your dashboard.
                  </p>
                </>
              )}
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
