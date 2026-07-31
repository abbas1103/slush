import type { Metadata } from "next";
import Link from "next/link";
import { getMyBooking } from "@/lib/db/queries";
import { deriveTickets, ticketQrDataUrl, ticketScanUrl } from "@/lib/tickets";
import { issueTicketTokens } from "@/lib/db/tickets";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Money } from "@/components/ui/Money";
import { buttonVariants } from "@/components/ui/Button";
import { formatDateRange } from "@/lib/utils/dates";

export const metadata: Metadata = {
  title: "My tickets - SLUSH",
  // Signed-in surface: never index it, and don't follow links out of it.
  robots: { index: false, follow: false },
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default async function TicketsPage() {
  const data = await getMyBooking();
  if (!data) {
    return (
      <div className="mx-auto max-w-[1120px] px-6 py-16 text-center">
        <h1>No tickets yet</h1>
        <p className="mt-2 text-soft">Book a trip to see your tickets here.</p>
        <Link href="/trip" className={buttonVariants({ variant: "dark" }) + " mt-4 inline-flex"}>
          Enter a trip code →
        </Link>
      </div>
    );
  }

  const { booking, trip, balance, selectedExtras } = data;
  const confirmed = booking.status === "confirmed" || booking.status === "converted";
  const start = new Date(`${trip.start_date}T00:00:00`).getTime();
  const withinSeven = start - Date.now() <= SEVEN_DAYS_MS;
  const unlocked = confirmed && (balance <= 0 || withinSeven);

  // Tokens are issued (idempotently) only once the tickets are unlocked - there is
  // no reason for a live QR to exist for a booking that cannot travel yet. The QR
  // encodes a /scan/<token> URL so a rep can use their phone's ordinary camera.
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const issued = unlocked
    ? await issueTicketTokens(booking.id, booking.reference, selectedExtras)
    : deriveTickets(booking.reference, selectedExtras).map((t) => ({ ...t, token: null }));
  const rendered = await Promise.all(
    issued.map(async (t) => ({
      ...t,
      qr: t.token ? await ticketQrDataUrl(ticketScanUrl(t.token, site)) : null,
    })),
  );

  return (
    <div className="mx-auto max-w-[1120px] px-6 py-8">
      <h1>My tickets</h1>
      <p className="mt-1 text-soft">Your lift pass and add-on tickets for the {trip.name}.</p>

      <div
        className={`mt-6 rounded-card p-5 ${unlocked ? "bg-okbg text-ok" : "bg-panel text-white"}`}
      >
        {unlocked ? (
          <div className="font-semibold">✓ Tickets active - show these QR codes in resort.</div>
        ) : booking.status === "pending" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">🔒 Finish your booking to unlock tickets</div>
              <div className="mt-1 text-[13px] text-white/70">
                You haven&apos;t paid your deposit yet. Pay it to confirm your place, then your QR
                tickets activate once your balance is cleared.
              </div>
            </div>
            <Link href={`/book/${booking.id}/payment`} className={buttonVariants({ variant: "out" }) + " inline-flex"}>
              Complete your booking
            </Link>
          </div>
        ) : booking.status === "refunded" || booking.status === "cancelled" ? (
          // getMyBooking deliberately surfaces refunded bookings so a student
          // keeps a record of one. Without this branch they fell through to the
          // balance-owing state below and were asked to pay the full trip cost
          // for a place that no longer exists.
          <div>
            <div className="font-semibold">
              {booking.status === "refunded"
                ? "This booking has been refunded"
                : "This booking was cancelled"}
            </div>
            <div className="mt-1 text-[13px] text-white/70">
              {booking.status === "refunded"
                ? "There are no tickets for a refunded booking. Your refund covers everything you paid for this trip."
                : "There are no tickets for a cancelled booking. Enter your trip code again to start a new one."}
            </div>
          </div>
        ) : booking.status === "waitlisted" ? (
          <div>
            <div className="font-semibold">🕓 You&apos;re on the waiting list</div>
            <div className="mt-1 text-[13px] text-white/70">
              Your deposit is paid and you&apos;re in line for a place. We&apos;ll be in touch if one
              opens up - tickets activate once you have a confirmed place.
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">🔒 Tickets unlock once your balance is cleared</div>
              <div className="mt-1 text-[13px] text-white/70">
                Pay your remaining <Money pence={balance} /> (or wait until 7 days before travel) to
                activate your QR tickets.
              </div>
            </div>
            <Link href="/dashboard" className={buttonVariants({ variant: "out" }) + " inline-flex"}>
              Pay my balance
            </Link>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {rendered.map((t) => (
          <Card key={t.key} className="flex gap-4">
            <div className="grid size-[168px] shrink-0 place-items-center rounded-btn border border-line bg-soft-panel">
              {t.qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.qr} alt={`${t.title} QR code`} className="size-[152px]" />
              ) : (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-soft">Locked</span>
              )}
            </div>
            <div className="flex flex-col justify-center">
              <Pill variant={t.qr ? "success" : "tag"} dot={!!t.qr}>
                {t.qr ? "Active" : "Activates when paid"}
              </Pill>
              <div className="mt-2 text-[11px] uppercase tracking-wide text-soft">{t.category}</div>
              <div className="text-[15px] font-bold">{t.title}</div>
              <div className="mt-1 text-[12.5px] text-soft">
                {trip.name} · {formatDateRange(trip.start_date, trip.end_date)}
              </div>
              <div className="text-[12px] text-soft">{t.ticketId}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
