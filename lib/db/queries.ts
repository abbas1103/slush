import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/db/types";

export type ExtraWithTiers = Tables<"extras"> & {
  extra_tiers: Tables<"extra_tiers">[];
};

export interface TripDetail {
  trip: Tables<"trips">;
  extras: ExtraWithTiers[];
  isFull: boolean;
}

/**
 * Resolve a trip code to its full detail (trip + active extras + tiers +
 * effective-full flag). Runs as the logged-in user; RLS lets them read the live
 * trip and its active extras. The trip_codes table itself stays hidden — the
 * code is resolved via the redeem_trip_code RPC. Returns null if the code is
 * invalid/inactive or the trip isn't live.
 */
export async function getTripByCode(code: string): Promise<TripDetail | null> {
  const supabase = await createClient();

  const { data: tripId } = await supabase.rpc("redeem_trip_code", {
    p_code: code.trim(),
  });
  if (!tripId) return null;

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) return null;

  const { data: extras } = await supabase
    .from("extras")
    .select("*, extra_tiers(*)")
    .eq("trip_id", tripId)
    .eq("active", true)
    .order("sort_order");

  const { data: isFull } = await supabase.rpc("trip_effective_full", {
    p_trip_id: tripId,
  });

  const normalised: ExtraWithTiers[] = (extras ?? []).map((e) => ({
    ...e,
    extra_tiers: [...(e.extra_tiers ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    ),
  }));

  return { trip, extras: normalised, isFull: !!isFull };
}
