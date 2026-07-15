import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminTripBookings } from "@/lib/db/admin-queries";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Money } from "@/components/ui/Money";
import { buttonVariants } from "@/components/ui/Button";
import { BookingActions } from "@/components/admin/BookingActions";
import { cn } from "@/lib/utils/cn";

const FILTERS = ["all", "confirmed", "waitlisted", "converted", "refunded", "pending"];

export default async function AdminBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const { status } = await searchParams;
  const { trip, rows } = await getAdminTripBookings(id);
  if (!trip) notFound();

  const active = status && FILTERS.includes(status) ? status : "all";
  const filtered = active === "all" ? rows : rows.filter((r) => r.status === active);

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

      <Card className="mt-4 overflow-x-auto" padding="sm">
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
                  <div className="text-[11px] text-soft">{r.studentEmail}</div>
                </td>
                <td className="p-2">
                  <Pill variant={r.status === "waitlisted" || r.status === "refunded" ? "error" : r.status === "pending" ? "tag" : "success"}>
                    {r.status}
                  </Pill>
                </td>
                <td className="p-2 text-right"><Money pence={r.tripCost} /></td>
                <td className="p-2 text-right"><Money pence={r.paidToTrip} /></td>
                <td className="p-2 text-right"><Money pence={r.balance} /></td>
                <td className="p-2">{r.damageStatus ?? "—"}</td>
                <td className="p-2">
                  <BookingActions bookingId={r.id} tripId={id} status={r.status} damageStatus={r.damageStatus} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="p-4 text-center text-soft">No bookings{active !== "all" ? ` with status "${active}"` : ""}.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
