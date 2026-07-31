import { NextResponse } from "next/server";
import { processCrmOutbox } from "@/lib/crm/process";
import { sweepAbandonedIntents } from "@/lib/booking/abandoned";
import { drainEmailOutbox } from "@/lib/email/outbox";
import { sendBalanceReminders } from "@/lib/email/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Declared explicitly rather than inherited. The drain's wall-clock budget is set
 * against this number, and relying on the platform default meant the budget was
 * guessing: on Hobby the default is 10s, so 60 gives the drain room to clear a
 * launch-day backlog in one run instead of a handful of events. Raise both this
 * and DEFAULT_BUDGET_MS in lib/crm/process.ts together, never one alone.
 */
export const maxDuration = 60;

/**
 * Nightly maintenance. Protected by CRON_SECRET (Vercel Cron sends it as a
 * Bearer token). Configure the schedule in vercel.json at deploy.
 *
 * Two jobs share this route rather than taking a second cron slot, because
 * Vercel caps how many a plan may schedule and neither job is urgent: the CRM
 * outbox is eventually-consistent by design, and an abandoned intent has already
 * released its place via the 30-minute hold, so clearing it a few hours later
 * costs nothing. They run independently - a CRM failure must not stop the sweep.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Reminders first and awaited separately, so anything it queues is drained by
  // the same run rather than waiting a day.
  const reminders = await Promise.allSettled([sendBalanceReminders()]).then((r) => r[0]);

  const [crm, abandoned, email] = await Promise.allSettled([
    processCrmOutbox(),
    sweepAbandonedIntents(),
    // Retry net for inline sends, and the delivery path for the reminders above.
    drainEmailOutbox(),
  ]);

  const value = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" ? r.value : { error: String(r.reason).slice(0, 200) };

  // 5xx so a silent failure shows red in the Vercel cron log and reaches Sentry.
  const failed = [crm, abandoned, email, reminders].some((r) => r.status === "rejected");
  return NextResponse.json(
    { crm: value(crm), abandoned: value(abandoned), reminders: value(reminders), email: value(email) },
    { status: failed ? 500 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
