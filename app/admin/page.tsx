import Link from "next/link";
import { getAdminTrips } from "@/lib/db/admin-queries";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Money } from "@/components/ui/Money";
import { buttonVariants } from "@/components/ui/Button";
import { formatDateRange } from "@/lib/utils/dates";
import { requireAdminMfa } from "@/lib/auth/guards";

export default async function AdminHome() {
  await requireAdminMfa();
  const trips = await getAdminTrips();
  const totalExposure = trips.reduce((s, t) => s + t.exposure, 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1>Trips</h1>
        <Link href="/admin/trips/new" className={buttonVariants({ variant: "dark" })}>
          + New trip
        </Link>
      </div>

      {totalExposure > 0 && (
        <Card className="mt-4" tone="dark">
          <div className="text-[13px] text-white/70">Total waiting-list refund exposure</div>
          <div className="text-[24px] font-extrabold text-white">
            <Money pence={totalExposure} grouped />
          </div>
          <div className="text-[12px] text-white/60">
            Deposits held for un-converted waitlisters — a real refund liability.
          </div>
        </Card>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {trips.map((t) => (
          <Card key={t.id} className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold">{t.name}</span>
                <Pill variant={t.status === "live" ? "success" : t.status === "closed" ? "tag" : "tag"} dot={t.status === "live"}>
                  {t.status}
                </Pill>
              </div>
              <div className="text-[13px] text-soft">
                {t.resort} · {formatDateRange(t.start_date, t.end_date)}
              </div>
              <div className="mt-1 text-[12.5px] text-soft">
                {t.confirmed_count}/{t.capacity} confirmed
                {t.waitlistCount > 0 && (
                  <> · {t.waitlistCount} waitlisted · <Money pence={t.exposure} grouped /> exposure</>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/admin/trips/${t.id}`} className={buttonVariants({ variant: "out", size: "sm" })}>
                Edit
              </Link>
              <Link href={`/admin/trips/${t.id}/extras`} className={buttonVariants({ variant: "out", size: "sm" })}>
                Extras
              </Link>
              <Link href={`/admin/trips/${t.id}/bookings`} className={buttonVariants({ variant: "dark", size: "sm" })}>
                Bookings
              </Link>
            </div>
          </Card>
        ))}
        {trips.length === 0 && <p className="text-soft">No trips yet. Create your first one.</p>}
      </div>
    </div>
  );
}
