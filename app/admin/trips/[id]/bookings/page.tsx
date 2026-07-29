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

/**
 * Below lg every cell is a labelled row of its own (the <thead> is hidden), so
 * the table reads as a stack on a phone without a second copy of the list in the
 * DOM. `before:content-[attr(data-label)]` prints the column name from the cell's
 * own data-label attribute.
 */
const CELL = cn(
  "flex items-baseline justify-between gap-4 px-0 py-0.5",
  "before:content-[attr(data-label)] before:text-soft before:text-[12px] before:font-medium",
  "lg:table-cell lg:p-2 lg:before:content-none",
);

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

      {/*
        ONE render of the list, not two. This used to be a stacked-card list for
        phones plus a table for desktop, both always in the DOM with CSS hiding
        one - so a full 300-place trip shipped 600 rows and mounted 600
        BookingActions client components, half of them invisible.

        It is a real <table> at lg and above. Below that, each row becomes a
        stacked block: the header is hidden and every cell prints its own label
        from data-label, so the semantics and the single DOM tree survive without
        an 830px sideways scroll on a phone.
      */}
      <Card className="mt-4 lg:overflow-x-auto" padding="sm">
        <table className="w-full text-left text-[13px]">
          <thead className="hidden text-soft lg:table-header-group">
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
          <tbody className="block lg:table-row-group">
            {filtered.map((r) => (
              <tr
                key={r.id}
                className={cn(
                  "block border-b border-line-2 py-3 first:pt-0 last:border-0",
                  "lg:table-row lg:py-0 lg:align-top",
                )}
              >
                <td className={cn(CELL, "font-mono")} data-label="Reference">
                  {r.reference}
                </td>
                <td className={CELL} data-label="Student">
                  <div className="min-w-0 text-right lg:text-left">
                    <div>{r.studentName}</div>
                    <div className="break-all text-[11px] text-soft">{r.studentEmail}</div>
                  </div>
                </td>
                <td className={CELL} data-label="Status">
                  <Pill variant={statusVariant(r.status)}>{r.status}</Pill>
                </td>
                <td className={cn(CELL, "lg:text-right")} data-label="Trip cost">
                  <Money pence={r.tripCost} />
                </td>
                <td className={cn(CELL, "lg:text-right")} data-label="Paid">
                  <Money pence={r.paidToTrip} />
                </td>
                <td className={cn(CELL, "lg:text-right")} data-label="Balance">
                  {noBalance(r.status) ? <span className="text-soft">-</span> : <Money pence={r.balance} />}
                </td>
                <td className={cn(CELL, "lg:text-right")} data-label="Damage">
                  {r.damageStatus ?? "-"}
                </td>
                {/* The actions need the full width on a phone, so no label here. */}
                <td className="block pt-2 lg:table-cell lg:p-2">
                  <BookingActions
                    bookingId={r.id}
                    tripId={id}
                    status={r.status}
                    damageStatus={r.damageStatus}
                    reference={r.reference}
                    refundableTotal={r.refundableTotal}
                    damageRefundAmount={r.damageRefundAmount}
                  />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr className="block lg:table-row">
                <td className="block p-4 text-center text-soft lg:table-cell" colSpan={8}>
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
