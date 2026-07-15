import Link from "next/link";
import { getMyBooking } from "@/lib/db/queries";
import { deriveTickets, signTicketToken, ticketQrDataUrl } from "@/lib/tickets";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Money } from "@/components/ui/Money";
import { buttonVariants } from "@/components/ui/Button";
import { formatDateRange } from "@/lib/utils/dates";

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

  const tickets = deriveTickets(booking.reference, selectedExtras);
  const exp = Math.floor(new Date(`${trip.end_date}T23:59:59`).getTime() / 1000);
  const rendered = await Promise.all(
    tickets.map(async (t) => ({
      ...t,
      qr: unlocked ? await ticketQrDataUrl(signTicketToken(booking.id, t.ticketId, exp)) : null,
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
          <div className="font-semibold">✓ Tickets active — show these QR codes in resort.</div>
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
            <div className="grid size-[120px] shrink-0 place-items-center rounded-btn border border-line bg-soft-panel">
              {t.qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.qr} alt={`${t.title} QR code`} className="size-[108px]" />
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
