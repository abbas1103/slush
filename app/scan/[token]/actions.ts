"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/guards";
import { recordScan, type ScanOutcome } from "@/lib/db/tickets";
import { rateLimit } from "@/lib/ratelimit";

export type CheckInResult =
  | { ok: true; outcome: ScanOutcome }
  | { ok: false; error: string };

// base64url of 32 bytes. Rejects nonsense before it reaches the database.
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);

/**
 * Record a check-in for a scanned ticket.
 *
 * Separate from rendering the page on purpose: resolving a token is read-only, so
 * a refresh, a link prefetch or a back button cannot consume a scan. Only this
 * explicit action appends to the log.
 */
export async function checkIn(token: string): Promise<CheckInResult> {
  const staff = await requireStaff();

  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return { ok: false, error: "That ticket isn't recognised." };

  // Keyed on the rep, not the token: bounds a compromised staff session rather
  // than one busy coach door.
  if (!(await rateLimit("payment", staff.id))) {
    return { ok: false, error: "Too many scans in a row - wait a moment and try again." };
  }

  const result = await recordScan(parsed.data, staff.id);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/scan/${parsed.data}`);
  return { ok: true, outcome: result.outcome };
}
