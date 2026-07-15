import { notFound, redirect } from "next/navigation";
import { getBookingContext } from "@/lib/db/queries";
import { computePricing } from "@/lib/pricing/compute";
import { createClient } from "@/lib/supabase/server";
import { decryptPII } from "@/lib/crypto/pii";
import { FlowBar } from "@/components/chrome/FlowBar";
import { DetailsForm, type DetailsInitial } from "@/components/booking/DetailsForm";
import { formatDateRange } from "@/lib/utils/dates";

export default async function DetailsPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const ctx = await getBookingContext(bookingId);
  if (!ctx) notFound();
  if (ctx.booking.status !== "pending") redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user!.id)
    .maybeSingle();
  const { data: emergency } = await supabase
    .from("emergency_contacts")
    .select("*")
    .eq("user_id", user!.id)
    .maybeSingle();
  const { data: bookingRow } = await supabase
    .from("bookings")
    .select("insurance_details")
    .eq("id", bookingId)
    .maybeSingle();

  const coverExtra = ctx.extras.find((e) => e.type === "other") ?? null;
  const coverPrice = coverExtra?.price ?? 0;

  // Base pricing EXCLUDES the insurance cover, so the form can add/remove it live.
  const nonCoverSelected = ctx.selected.filter((s) => s.extra_id !== coverExtra?.id);
  const lineItems = nonCoverSelected.map((s) => {
    const ex = ctx.extras.find((e) => e.id === s.extra_id);
    const tier = ex?.extra_tiers.find((t) => t.id === s.extra_tier_id);
    return {
      label: `${ex?.name ?? "Extra"}${tier ? ` — ${tier.name}` : ""}`,
      amount: s.price_at_booking * s.quantity,
    };
  });
  const basePricing = computePricing({
    basePrice: ctx.trip.base_price,
    depositAmount: ctx.trip.deposit_amount,
    downpaymentAmount: ctx.trip.downpayment_amount,
    damageDepositAmount: ctx.trip.damage_deposit_amount,
    extras: lineItems,
  });

  const insDetails = (bookingRow?.insurance_details ?? null) as
    | { insurer?: string; policy?: string; emergency_line?: string }
    | null;

  const initial: DetailsInitial = {
    title: profile?.title ?? "",
    firstName: profile?.first_name ?? "",
    lastName: profile?.last_name ?? "",
    universitySociety: profile?.university_society ?? "",
    studentId: profile?.student_id ?? "",
    dob: decryptPII(profile?.dob) ?? "",
    nationality: profile?.nationality ?? "",
    passport: decryptPII(profile?.passport_number) ?? "",
    phone: decryptPII(profile?.phone) ?? "",
    emergencyName: decryptPII(emergency?.full_name) ?? "",
    emergencyRelationship: emergency?.relationship ?? "",
    emergencyPhone: decryptPII(emergency?.phone) ?? "",
    accessNeeds: decryptPII(ctx.booking.access_needs) ?? "",
    insuranceChoice: (ctx.booking.insurance_choice as "own" | "bought" | null) ?? "own",
    insurer: insDetails?.insurer ?? "",
    policyNumber: decryptPII(insDetails?.policy) ?? "",
    insuranceEmergencyLine: insDetails?.emergency_line ?? "",
  };

  return (
    <>
      <FlowBar step={2} backHref={`/book/${bookingId}/extras`} backLabel="Back to extras" />
      <DetailsForm
        bookingId={bookingId}
        tripName={ctx.trip.name}
        tripMeta={`${ctx.trip.resort} · ${formatDateRange(ctx.trip.start_date, ctx.trip.end_date)} · 1 place`}
        email={user!.email ?? ""}
        basePricing={basePricing}
        coverPrice={coverPrice}
        initial={initial}
      />
    </>
  );
}
