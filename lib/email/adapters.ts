import "server-only";
import nodemailer from "nodemailer";
import type { EmailAdapter, EmailMessage } from "./types";

/**
 * Provider adapters, selected by EMAIL_PROVIDER. Same shape as the CRM adapters
 * so there is one idiom in the codebase rather than two.
 *
 *   log  (default) - renders and logs, delivers nothing. Inert in dev and in any
 *                    environment where the provider was never configured.
 *   smtp           - any SMTP host. Zoho Mail today; note Zoho's free plan does
 *                    not permit external SMTP, and Zoho Mail (like Gmail) is for
 *                    human mail, so this is a stopgap rather than the destination.
 *
 * A transactional provider (ZeptoMail, Resend, Postmark) belongs here next: it
 * adds bounce webhooks and a suppression list, which SMTP cannot give us. A
 * wrong address currently fails silently, and for a receipt attached to £150
 * that is the failure that turns into a chargeback.
 */

class LogAdapter implements EmailAdapter {
  readonly name = "log";
  // Critically false: the drain must leave rows pending rather than mark them
  // sent. The CRM outbox's log adapter claimed success and left seven rows
  // permanently unsendable with no trace of what was lost.
  readonly delivers = false;
  async send(message: EmailMessage): Promise<void> {
    console.log(`[email:log] would send "${message.subject}" to ${message.to}`);
  }
}

class SmtpAdapter implements EmailAdapter {
  readonly name = "smtp";
  readonly delivers = true;
  private readonly from: string;
  private readonly transport: nodemailer.Transporter;

  constructor(opts: { host: string; port: number; user: string; pass: string; from: string }) {
    this.from = opts.from;
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      // 465 is implicit TLS; 587 upgrades via STARTTLS. Never plaintext.
      secure: opts.port === 465,
      requireTLS: opts.port !== 465,
      auth: { user: opts.user, pass: opts.pass },
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

let cached: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (cached) return cached;

  const provider = (process.env.EMAIL_PROVIDER ?? "log").toLowerCase();
  if (provider !== "smtp") {
    cached = new LogAdapter();
    return cached;
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.EMAIL_FROM;
  const port = Number(process.env.SMTP_PORT ?? 587);

  // Misconfiguration degrades to inert rather than throwing: a missing SMTP
  // password must not take down the webhook that records payments.
  if (!host || !user || !pass || !from) {
    console.error("[email] EMAIL_PROVIDER=smtp but SMTP_HOST/USER/PASSWORD/EMAIL_FROM incomplete - staying inert");
    cached = new LogAdapter();
    return cached;
  }

  cached = new SmtpAdapter({ host, port, user, pass, from });
  return cached;
}

/** Tests only: drop the memoised adapter so env changes take effect. */
export function resetEmailAdapter(): void {
  cached = null;
}
