import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueEmail } from "./outbox";

/**
 * Balance reminders. Runs daily from the cron; each stage fires once per booking.
 *
 * Two nudges rather than one: a fortnight out is enough notice to move money, and
 * three days out catches the people who read the first one and forgot. More than
 * that reads as nagging for what is usually a single payment.
 *
 * Enqueue only - the cron drains immediately afterwards. The dedupe key carries
 * the stage, so the 14-day and 3-day nudges are distinct messages while a rerun
 * of either sends nothing.
 */

const STAGES = [
  { days: 14, label: "14d" },
  { days: 3, label: "3d" },
] as const;

export interface ReminderResult {
  due: number;
  queued: number;
  skipped: number;
  failed: number;
}

export async function sendBalanceReminders(): Promise<ReminderResult> {
  const admin = createAdminClient();
  const out: ReminderResult = { due: 0, queued: 0, skipped: 0, failed: 0 };

  for (const stage of STAGES) {
    const { data: rows, error } = await admin.rpc("bookings_due_balance", { p_days: stage.days });
    if (error) {
      out.failed++;
      console.error(`[reminders] ${stage.label} lookup failed:`, error.message);
      continue;
    }
    const due = rows ?? [];
    if (due.length === 0) continue;
    out.due += due.length;

    // One read for the recipients rather than one per booking.
    const ids = due.map((r) => r.booking_id);
    const { data: details, error: detailError } = await admin
      .from("bookings")
      .select("id, reference, users(first_name, email), trips(name, balance_due_date)")
      .in("id", ids);
    if (detailError) {
      out.failed++;
      console.error(`[reminders] ${stage.label} detail read failed:`, detailError.message);
      continue;
    }

    const byId = new Map((details ?? []).map((d) => [d.id, d]));
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

    for (const row of due) {
      const d = byId.get(row.booking_id);
      const user = d?.users as { first_name: string | null; email: string | null } | null;
      const trip = d?.trips as { name: string; balance_due_date: string | null } | null;
      if (!user?.email) {
        out.skipped++;
        continue;
      }
      const created = await enqueueEmail({
        dedupeKey: `balance-reminder:${row.booking_id}:${stage.label}`,
        to: user.email,
        template: "balance_reminder",
        payload: {
          firstName: user.first_name ?? undefined,
          reference: d?.reference,
          tripName: trip?.name,
          // Straight from booking_balance(), never recomputed here.
          balance: row.balance,
          balanceDueDate: row.due_date
            ? new Date(row.due_date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })
            : undefined,
          ticketsUrl: site ? `${site}/dashboard` : undefined,
        },
      });
      if (created) out.queued++;
      else out.skipped++;
    }
  }

  return out;
}
