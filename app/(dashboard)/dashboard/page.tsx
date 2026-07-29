import type { Metadata } from "next";
import Link from "next/link";
import { getMyBooking } from "@/lib/db/queries";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Money } from "@/components/ui/Money";
import { MetricTile } from "@/components/ui/MetricTile";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { buttonVariants } from "@/components/ui/Button";
import { MakePayment } from "@/components/dashboard/MakePayment";
import { PaymentReturn } from "@/components/booking/PaymentReturn";
import { formatDate, formatDateRange } from "@/lib/utils/dates";
import { formatPence } from "@/lib/utils/money";

export const metadata: Metadata = {
  title: "My booking - SLUSH",
  // Signed-in surface: never index it, and don't follow links out of it.
  robots: { index: false, follow: false },
};

const PAYMENT_LABELS: Record<string, string> = {
  deposit: "Deposit downpayment",
  balance: "Balance payment",
  damage_deposit_hold: "Refundable damage deposit",
  damage_deposit_refund: "Damage deposit refund",
  waitlist_refund: "Waiting-list refund",
};

export default async function DashboardPage() {
  const data = await getMyBooking();

  if (!data) {
    return (
      <div className="mx-auto max-w-[1120px] px-6 py-16 text-center">
        <h1>No bookings yet</h1>
        <p className="mt-2 text-soft">Enter your trip code to view your trip and book your place.</p>
        <Link href="/trip" className={buttonVariants({ variant: "dark" }) + " mt-4 inline-flex"}>
          Enter a trip code →
        </Link>
      </div>
    );
  }

  const { booking, trip, pricing, paidToTrip, balance, damageStatus, payments, isTerminal } = data;
  const damageLabel =
    damageStatus === "held" ? "held" : damageStatus === "refunded" ? "refunded" : damageStatus === "withheld" ? "withheld" : null;
  const cleared = balance <= 0;
  const confirmed = booking.status === "confirmed" || booking.status === "converted";
  const pct = pricing.tripCost > 0 ? (paidToTrip / pricing.tripCost) * 100 : 0;
  // A refunded booking is over and a pending one hasn't paid its deposit, so
  // neither may be dressed up as "Confirmed · deposit paid".
  const statusPill: { variant: "success" | "error" | "tag"; label: string } = isTerminal
    ? { variant: "error", label: "Refunded" }
    : booking.status === "waitlisted"
      ? { variant: "error", label: "On the waiting list" }
      : booking.status === "pending"
        ? { variant: "tag", label: "Deposit not paid yet" }
        : booking.status === "converted"
          ? { variant: "success", label: "Confirmed" }
          : { variant: "success", label: "Confirmed · deposit paid" };

  return (
    <div className="mx-auto max-w-[1120px] px-6 py-8">
      <PaymentReturn bookingId={booking.id} />
      <h1>My booking</h1>
      <p className="mt-1 break-words text-soft">
        {trip.name} · {trip.organiser} · Ref {booking.reference}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Trip total" value={<Money pence={pricing.tripCost} />} sub="All extras included" />
        <MetricTile
          label="Paid to trip"
          value={<Money pence={paidToTrip} />}
          sub={cleared ? "Paid in full" : `${Math.round(pct)}% paid`}
        />
        <MetricTile
          label="Remaining balance"
          value={<Money pence={balance} />}
          sub={isTerminal ? "Booking refunded" : cleared ? "All cleared" : "Pay any time"}
          dark
        />
        <MetricTile
          label="Pay by"
          value={formatDate(trip.balance_due_date)}
          sub={
            isTerminal
              ? "Nothing left to pay"
              : damageLabel
                ? `${formatPence(trip.damage_deposit_amount, { stripZeros: true })} deposit ${damageLabel}`
                : undefined
          }
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <Card padding="lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold">{trip.name}</div>
                <div className="text-[13px] text-soft">
                  {trip.resort} · {formatDateRange(trip.start_date, trip.end_date)} · {trip.nights} nights
                </div>
              </div>
              <Pill variant={statusPill.variant} dot>
                {statusPill.label}
              </Pill>
            </div>
            <div className="mt-4">
              <ProgressBar value={pct} label="Payment progress" />
              <div className="mt-2 text-[12.5px] text-soft">
                <Money pence={paidToTrip} /> of <Money pence={pricing.tripCost} /> trip cost paid
                {damageLabel && <> · <Money pence={trip.damage_deposit_amount} stripZeros /> damage deposit {damageLabel}</>}
              </div>
            </div>
          </Card>

          <Card padding="lg">
            <h3 className="mb-3">Payment history</h3>
            {payments.length === 0 ? (
              <p className="text-[13px] text-soft">No payments yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-soft">
                    <tr className="border-b border-line">
                      <th className="py-2 font-medium">Date</th>
                      <th className="py-2 font-medium">Description</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, i) => (
                      <tr key={i} className="border-b border-line-2">
                        <td className="py-2.5">{formatDate(p.created_at.slice(0, 10))}</td>
                        <td className="py-2.5">{PAYMENT_LABELS[p.type] ?? p.type}</td>
                        <td className="py-2.5 text-right font-semibold">
                          <Money pence={p.amount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          {isTerminal && (
            <Card>
              <h3 className="mb-1">This booking is refunded</h3>
              <p className="text-[13px] text-soft">
                Your deposit has gone back to the card you paid with. Nothing is owed and no tickets
                are issued - your payment history is your receipt.
              </p>
            </Card>
          )}
          {booking.status === "pending" && (
            <Card>
              <h3 className="mb-1">Complete your booking</h3>
              <p className="text-[13px] text-soft">
                You haven&apos;t paid your deposit yet. Pay your <Money pence={trip.deposit_amount} stripZeros /> deposit to confirm your place.
              </p>
              <Link
                href={`/book/${booking.id}/payment`}
                className={buttonVariants({ variant: "dark" }) + " mt-3 inline-flex w-full"}
              >
                Pay your deposit →
              </Link>
            </Card>
          )}
          {confirmed && !cleared && (
            <Card>
              <h3 className="mb-1">Make a payment</h3>
              <MakePayment bookingId={booking.id} balance={balance} />
            </Card>
          )}
          {cleared && !isTerminal && (
            <Card>
              <div className="text-[15px] font-bold">Balance cleared 🎉</div>
              <p className="mt-1 text-[13px] text-soft">
                You&apos;re all paid up - your tickets are unlocked.
                {damageStatus === "held" && <> Your <Money pence={trip.damage_deposit_amount} stripZeros /> damage deposit is refunded after the trip.</>}
                {damageStatus === "refunded" && <> Your <Money pence={trip.damage_deposit_amount} stripZeros /> damage deposit has been refunded.</>}
              </p>
            </Card>
          )}
          <Card tone="dark">
            <div className="text-[15px] font-bold text-white">🎫 Your tickets</div>
            <p className="mt-1 text-[13px] text-white/70">
              {isTerminal
                ? "Tickets aren't active for a refunded booking."
                : "Your lift pass and add-on tickets unlock once your balance is cleared (or 7 days before travel)."}
            </p>
            <Link href="/tickets" className={buttonVariants({ variant: "out" }) + " mt-3 inline-flex w-full"}>
              View my tickets →
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}

