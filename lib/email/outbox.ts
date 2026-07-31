import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailAdapter } from "./adapters";
import { renderEmail } from "./templates";
import type { EmailPayload, EmailTemplate } from "./types";

/**
 * Enqueue and drain. Service-role only; nothing client-facing writes here.
 *
 * Two-phase on purpose. `enqueueEmail` writes a durable row and returns fast, so
 * the Stripe webhook is never held open by an SMTP handshake and a mail outage
 * can never 5xx a delivery that already recorded money. `drainEmailOutbox` does
 * the sending: called inline right after enqueue so mail is immediate in the
 * normal case, and again from the nightly cron as the retry net.
 */

const MAX_ATTEMPTS = 6;
const DEFAULT_BATCH = 50;

export interface EnqueueArgs {
  /** MUST be derived from the cause, e.g. `receipt:${stripeEventId}`. */
  dedupeKey: string;
  to: string;
  template: EmailTemplate;
  payload: EmailPayload;
}

/**
 * Returns true if a new row was created, false if this email was already
 * enqueued. Stripe retries a delivery for up to three days, so the unique
 * constraint - not the caller's memory - is what stops four identical receipts.
 */
export async function enqueueEmail(args: EnqueueArgs): Promise<boolean> {
  if (!args.to) {
    console.error(`[email] refusing to enqueue ${args.template}: no recipient`);
    return false;
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_outbox")
    .upsert(
      {
        dedupe_key: args.dedupeKey,
        to_email: args.to,
        template: args.template,
        payload: args.payload as never,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    // Never throw: the caller is usually the webhook, and failing to queue a
    // receipt must not fail the delivery that recorded the payment.
    console.error(`[email] enqueue failed (${args.template}):`, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export interface DrainResult {
  total: number;
  sent: number;
  failed: number;
  /** Left queued because the adapter delivers nothing. */
  queued: number;
  note?: string;
}

export async function drainEmailOutbox(limit = DEFAULT_BATCH): Promise<DrainResult> {
  const admin = createAdminClient();
  const adapter = getEmailAdapter();

  const { data: rows, error } = await admin
    .from("email_outbox")
    .select("id, dedupe_key, to_email, template, payload, attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("attempts", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`email_outbox select failed: ${error.message}`);

  const queue = rows ?? [];
  if (queue.length === 0) return { total: 0, sent: 0, failed: 0, queued: 0 };

  // Inert adapter: leave everything queued and say so loudly. Marking rows sent
  // when nothing was delivered is precisely how the CRM outbox lost seven events.
  if (!adapter.delivers) {
    console.warn(
      `[email] adapter '${adapter.name}' delivers nothing - leaving ${queue.length} message(s) queued`,
    );
    return {
      total: queue.length,
      sent: 0,
      failed: 0,
      queued: queue.length,
      note: `adapter '${adapter.name}' delivers nothing`,
    };
  }

  let sent = 0;
  let failed = 0;

  for (const row of queue) {
    try {
      const rendered = renderEmail(row.template as EmailTemplate, (row.payload ?? {}) as EmailPayload);
      await adapter.send({ to: row.to_email, ...rendered });
      const { error: markError } = await admin
        .from("email_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq("id", row.id);
      // Delivered but unrecorded: better to log loudly than to retry and send a
      // second copy of a receipt.
      if (markError) console.error(`[email] SENT but could not mark ${row.dedupe_key}:`, markError.message);
      sent++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      await admin
        .from("email_outbox")
        .update({ status: "failed", attempts: row.attempts + 1, last_error: message.slice(0, 500) })
        .eq("id", row.id);
      // Identify the send by outbox row, not by recipient address: no PII in logs.
      console.error(`[email] send failed (template ${row.template}, row ${row.id}):`, message);
    }
  }

  return { total: queue.length, sent, failed, queued: 0 };
}

/**
 * Enqueue and immediately try to deliver. Failure to send is swallowed: the row
 * survives and the nightly drain retries it, so the caller (a webhook that has
 * already taken money) is never blocked by the mail path.
 */
export async function enqueueAndSend(args: EnqueueArgs): Promise<void> {
  const created = await enqueueEmail(args);
  if (!created) return;
  try {
    await drainEmailOutbox(5);
  } catch (e) {
    console.error("[email] inline drain failed, leaving for the cron:", e instanceof Error ? e.message : e);
  }
}
