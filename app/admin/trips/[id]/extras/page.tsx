import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminTrip } from "@/lib/db/admin-queries";
import { ExtrasManager } from "@/components/admin/ExtrasManager";
import type { Tables } from "@/lib/db/types";
import { requireAdminMfa } from "@/lib/auth/guards";

export default async function AdminExtrasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminMfa();
  const { id } = await params;
  const data = await getAdminTrip(id);
  if (!data) notFound();

  const extras = data.extras.map((e) => {
    const tiers = ((e as { extra_tiers?: Tables<"extra_tiers">[] }).extra_tiers ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order);
    return { ...e, extra_tiers: tiers };
  });

  return (
    <div>
      <Link href={`/admin/trips/${id}`} className="text-[13px] text-soft hover:text-ink">← {data.trip.name}</Link>
      <h1 className="mt-2 mb-4">Extras</h1>
      <ExtrasManager tripId={id} extras={extras} />
    </div>
  );
}
