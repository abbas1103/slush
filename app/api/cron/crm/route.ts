import { NextResponse } from "next/server";
import { processCrmOutbox } from "@/lib/crm/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
