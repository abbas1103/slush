import { NextResponse } from "next/server";
import { processCrmOutbox } from "@/lib/crm/process";

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
 * CRM outbox drain. Protected by CRON_SECRET (Vercel Cron sends it as a Bearer
 * token). Configure the schedule in vercel.json at deploy.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const result = await processCrmOutbox();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
