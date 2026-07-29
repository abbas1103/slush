import * as Sentry from "@sentry/nextjs";
import { requireAdminMfa } from "@/lib/auth/guards";
import { getAdminTripBookings } from "@/lib/db/admin-queries";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Guard a CSV cell against formula injection + quote as needed. Control
 * characters go FIRST: a bare CR inside a stored name starts a new record in a
 * spreadsheet, so the next cell begins with an attacker-chosen character and a
 * leading-character-only guard is defeated. No legitimate value in this export
 * contains one, so they collapse to a space (and the trim keeps the leading
 * formula test looking at the real first character).
 */
function csv(value: string | number): string {
  let s = String(value ?? "").replace(/[\p{Cc}\u2028\u2029]/gu, " ").trim();
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise leading formula chars
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin_user = await requireAdminMfa();
  const { id } = await params;
  const { trip, rows } = await getAdminTripBookings(id);

  const header = ["Reference", "Student", "Email", "Status", "Trip cost", "Paid to trip", "Balance", "Damage deposit", "Booked"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.reference,
        r.studentName,
        r.studentEmail,
        r.status,
        (r.tripCost / 100).toFixed(2),
        (r.paidToTrip / 100).toFixed(2),
        (r.balance / 100).toFixed(2),
        r.damageStatus ?? "",
        r.createdAt.slice(0, 10),
      ].map(csv).join(","),
    );
  }
  const body = lines.join("\r\n");

  // Log the export (who/when) - never the row data. A failed log must not block
  // the organiser's manifest, but it must not vanish either: an untraced bulk
  // export of every student's name and email is exactly what this row is for.
  const { error: auditErr } = await createAdminClient().from("audit_log").insert({
    actor_user_id: admin_user.id,
    actor_email: admin_user.email ?? null,
    action: "bookings_export",
    target_type: "trip",
    target_id: id,
    metadata: { rows: rows.length },
  });
  if (auditErr) {
    console.error(`[bookings-export] audit_log insert failed for trip ${id}: ${auditErr.message}`);
    Sentry.captureException(new Error(`bookings_export audit_log insert failed: ${auditErr.message}`), {
      tags: { area: "bookings-export" },
      extra: { trip_id: id, rows: rows.length },
    });
  }

  const filename = `bookings-${(trip?.name ?? "trip").replace(/\W+/g, "-").toLowerCase()}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Next only adds no-store to page renders, not to a Response built here.
      // This is every student's name and email at a URL that is the same for
      // every admin, so no browser, proxy or corporate appliance may keep it.
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}
