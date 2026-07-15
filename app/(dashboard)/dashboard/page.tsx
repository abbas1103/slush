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

  const { booking, trip, pricing, paidToTrip, balance, damageHeld, payments } = data;
  const cleared = balance <= 0;
  const confirmed = booking.status === "confirmed" || booking.status === "converted";
  const pct = pricing.tripCost > 0 ? (paidToTrip / pricing.tripCost) * 100 : 0;

  return (
    <div className="mx-auto max-w-[1120px] px-6 py-8">
      <PaymentReturn bookingId={booking.id} />
      <h1>My booking</h1>
      <p className="mt-1 text-soft">
        {trip.name} · {trip.organiser} · Ref {booking.reference}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Trip total" value={<Money pence={pricing.tripCost} />} sub="All extras included" />
        <MetricTile
          label="Paid to trip"
          value={<Money pence={paidToTrip} />}
          sub={cleared ? "Paid in full" : `${Math.round(pct)}% paid`}
        />
        <MetricTile label="Remaining balance" value={<Money pence={balance} />} sub={cleared ? "All cleared" : "Pay any time"} dark />
        <MetricTile
          label="Pay by"
          value={formatDate(trip.balance_due_date)}
          sub={damageHeld ? `${formatPence(trip.damage_deposit_amount)} deposit held` : undefined}
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
              <Pill variant={booking.status === "waitlisted" ? "error" : "success"} dot>
                {booking.status === "waitlisted"
                  ? "On the waiting list"
                  : booking.status === "converted"
                    ? "Confirmed"
                    : "Confirmed · deposit paid"}
              </Pill>
            </div>
            <div className="mt-4">
              <ProgressBar value={pct} label="Payment progress" />
              <div className="mt-2 text-[12.5px] text-soft">
                <Money pence={paidToTrip} /> of <Money pence={pricing.tripCost} /> trip cost paid
                {damageHeld && <> · <Money pence={trip.damage_deposit_amount} stripZeros /> refundable damage deposit held</>}
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
          {confirmed && !cleared && (
            <Card>
              <h3 className="mb-1">Make a payment</h3>
              <MakePayment bookingId={booking.id} balance={balance} />
            </Card>
          )}
          {cleared && (
            <Card>
              <div className="text-[15px] font-bold">Balance cleared 🎉</div>
              <p className="mt-1 text-[13px] text-soft">
                You&apos;re all paid up — your tickets are unlocked.
                {damageHeld && <> Your <Money pence={trip.damage_deposit_amount} stripZeros /> damage deposit is refunded after the trip.</>}
              </p>
            </Card>
          )}
          <Card tone="dark">
            <div className="text-[15px] font-bold text-white">🎫 Your tickets</div>
            <p className="mt-1 text-[13px] text-white/70">
              Your lift pass and add-on tickets unlock once your balance is cleared (or 7 days before travel).
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

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(0)}`;
}
