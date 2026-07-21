import { requireAdminMfa } from "@/lib/auth/guards";
import { getAdminTripBookings } from "@/lib/db/admin-queries";
import { createAdminClient } from "@/lib/supabase/admin";

/** Guard a CSV cell against formula injection + quote as needed. */
function csv(value: string | number): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise leading formula chars
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
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

  // Log the export (who/when) - never the row data.
  await createAdminClient().from("audit_log").insert({
    actor_user_id: admin_user.id,
    actor_email: admin_user.email ?? null,
    action: "bookings_export",
    target_type: "trip",
    target_id: id,
    metadata: { rows: rows.length },
  });

  const filename = `bookings-${(trip?.name ?? "trip").replace(/\W+/g, "-").toLowerCase()}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
