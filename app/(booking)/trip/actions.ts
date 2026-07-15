"use server";

import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export type ResolveResult =
  | {
      ok: true;
      code: string;
      name: string;
      organiser: string;
      resort: string;
      basePrice: number;
    }
  | { ok: false };

/**
 * Resolve a trip code to a summary for the code-entry screen. Runs server-side
 * (rate-limiting will be layered here once Upstash is configured). The code is
 * validated via the redeem_trip_code RPC — the trip_codes table is never
 * exposed to the client.
 */
export async function resolveTripCode(rawCode: string): Promise<ResolveResult> {
  const code = rawCode.trim();
  if (!code) return { ok: false };

  // Rate-limit code guessing (per IP). No-op until Upstash is configured.
  if (!(await rateLimit("tripCode", await clientIp()))) return { ok: false };

  const supabase = await createClient();
  const { data: tripId } = await supabase.rpc("redeem_trip_code", { p_code: code });
  if (!tripId) return { ok: false };

  const { data: trip } = await supabase
    .from("trips")
    .select("name, organiser, resort, base_price")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) return { ok: false };

  return {
    ok: true,
    code,
    name: trip.name,
    organiser: trip.organiser,
    resort: trip.resort,
    basePrice: trip.base_price,
  };
}
