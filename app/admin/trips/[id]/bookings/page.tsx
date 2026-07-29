import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminTripBookings } from "@/lib/db/admin-queries";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Money } from "@/components/ui/Money";
import { buttonVariants } from "@/components/ui/Button";
import { BookingActions } from "@/components/admin/BookingActions";
import { cn } from "@/lib/utils/cn";
import { requireAdminMfa } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Bookings - SLUSH admin",
  // Staff surface: never index it, and don't follow links out of it.
  robots: { index: false, follow: false },
};

const FILTERS = ["all", "confirmed", "waitlisted", "converted", "refunded", "pending"];

/** Pill colour for a booking status - shared by the table and the phone cards. */
function statusVariant(status: string) {
  if (status === "waitlisted" || status === "refunded") return "error" as const;
  if (status === "pending") return "tag" as const;
  return "success" as const;
}

export default async function AdminBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminMfa();
  const { id } = await params;
  const { status } = await searchParams;
  const { trip, rows } = await getAdminTripBookings(id);
  if (!trip) notFound();

  const active = status && FILTERS.includes(status) ? status : "all";
  const filtered = active === "all" ? rows : rows.filter((r) => r.status === active);
  const emptyLabel = `No bookings${active !== "all" ? ` with status "${active}"` : ""}.`;
  const noBalance = (s: string) => s === "cancelled" || s === "refunded";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/admin/trips/${id}`} className="text-[13px] text-soft hover:text-ink">← {trip.name}</Link>
          <h1 className="mt-2">Bookings</h1>
        </div>
        <a href={`/admin/trips/${id}/bookings/export`} className={buttonVariants({ variant: "dark" })}>
          ⬇ Export CSV
        </a>
      </div>

      <div className="mt-4 flex flex-wrap gap-1">
        {FILTERS.map((fkey) => (
          <Link
            key={fkey}
            href={`/admin/trips/${id}/bookings${fkey === "all" ? "" : `?status=${fkey}`}`}
            className={cn(
              "rounded-full px-3 py-1 text-[13px] font-medium",
              active === fkey ? "bg-ink text-white" : "bg-chip text-ink-2",
            )}
          >
            {fkey}
          </Link>
        ))}
      </div>

      {/* Eight columns don't fit a phone, so below lg the same rows render as
          stacked cards - refunding a waitlister shouldn't need a sideways swipe
          past six columns to reach the buttons. */}
      <div className="mt-4 flex flex-col gap-3 lg:hidden">
        {filtered.map((r) => (
          <Card key={r.id} padding="sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[13px]">{r.reference}</div>
                <div className="text-[14px] font-semibold">{r.studentName}</div>
                <div className="break-all text-[11px] text-soft">{r.studentEmail}</div>
              </div>
              <Pill variant={statusVariant(r.status)}>{r.status}</Pill>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line-2 pt-3 text-[13px]">
              <dt className="text-soft">Trip cost</dt>
              <dd className="text-right"><Money pence={r.tripCost} /></dd>
              <dt className="text-soft">Paid</dt>
              <dd className="text-right"><Money pence={r.paidToTrip} /></dd>
              <dt className="text-soft">Balance</dt>
              <dd className="text-right">
                {noBalance(r.status) ? <span className="text-soft">-</span> : <Money pence={r.balance} />}
              </dd>
              <dt className="text-soft">Damage</dt>
              <dd className="text-right">{r.damageStatus ?? "-"}</dd>
            </dl>
            <div className="mt-3">
              <BookingActions bookingId={r.id} tripId={id} status={r.status} damageStatus={r.damageStatus} />
            </div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <Card padding="sm" className="text-center text-soft">{emptyLabel}</Card>
        )}
      </div>

      <Card className="mt-4 hidden overflow-x-auto lg:block" padding="sm">
        <table className="w-full text-left text-[13px]">
          <thead className="text-soft">
            <tr className="border-b border-line">
              <th className="p-2 font-medium">Reference</th>
              <th className="p-2 font-medium">Student</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2 text-right font-medium">Trip cost</th>
              <th className="p-2 text-right font-medium">Paid</th>
              <th className="p-2 text-right font-medium">Balance</th>
              <th className="p-2 font-medium">Damage</th>
              <th className="p-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-line-2 align-top">
                <td className="p-2 font-mono">{r.reference}</td>
                <td className="p-2">
                  <div>{r.studentName}</div>
                  <div className="break-all text-[11px] text-soft">{r.studentEmail}</div>
                </td>
                <td className="p-2">
                  <Pill variant={statusVariant(r.status)}>{r.status}</Pill>
                </td>
                <td className="p-2 text-right"><Money pence={r.tripCost} /></td>
                <td className="p-2 text-right"><Money pence={r.paidToTrip} /></td>
                <td className="p-2 text-right">
                  {noBalance(r.status) ? (
                    <span className="text-soft">-</span>
                  ) : (
                    <Money pence={r.balance} />
                  )}
                </td>
                <td className="p-2">{r.damageStatus ?? "-"}</td>
                <td className="p-2">
                  <BookingActions bookingId={r.id} tripId={id} status={r.status} damageStatus={r.damageStatus} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="p-4 text-center text-soft">{emptyLabel}</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
