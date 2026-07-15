import Link from "next/link";
import { TripForm, type TripFormInitial } from "@/components/admin/TripForm";
import { requireAdminMfa } from "@/lib/auth/guards";

const defaults: TripFormInitial = {
  name: "",
  organiser: "",
  resort: "",
  country: "",
  start_date: "",
  end_date: "",
  nights: 7,
  base_price: 0,
  base_inclusions: [],
  deposit_amount: 15000,
  downpayment_amount: 5000,
  damage_deposit_amount: 10000,
  balance_due_date: null,
  capacity: 300,
  description: "",
  status: "draft",
};

export default async function NewTripPage() {
  await requireAdminMfa();
  return (
    <div>
      <Link href="/admin" className="text-[13px] text-soft hover:text-ink">← All trips</Link>
      <h1 className="mt-2 mb-4">New trip</h1>
      <TripForm tripId={null} initial={defaults} />
    </div>
  );
}
