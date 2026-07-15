import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminTrip } from "@/lib/db/admin-queries";
import { TripForm, type TripFormInitial } from "@/components/admin/TripForm";
import { CodeManager } from "@/components/admin/CodeManager";

export default async function EditTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getAdminTrip(id);
  if (!data) notFound();
  const { trip, codes } = data;

  const initial: TripFormInitial = {
    name: trip.name,
    organiser: trip.organiser,
    resort: trip.resort,
    country: trip.country,
    start_date: trip.start_date,
    end_date: trip.end_date,
    nights: trip.nights,
    base_price: trip.base_price,
    base_inclusions: Array.isArray(trip.base_inclusions) ? (trip.base_inclusions as string[]) : [],
    deposit_amount: trip.deposit_amount,
    downpayment_amount: trip.downpayment_amount,
    damage_deposit_amount: trip.damage_deposit_amount,
    balance_due_date: trip.balance_due_date,
    capacity: trip.capacity,
    description: trip.description ?? "",
    status: trip.status,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-[13px] text-soft hover:text-ink">← All trips</Link>
          <h1 className="mt-2">{trip.name}</h1>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/trips/${id}/extras`} className="text-[13px] text-soft hover:text-ink">Extras →</Link>
          <Link href={`/admin/trips/${id}/bookings`} className="text-[13px] text-soft hover:text-ink">Bookings →</Link>
        </div>
      </div>
      <TripForm tripId={id} initial={initial} />
      <CodeManager tripId={id} codes={codes} />
    </div>
  );
}
