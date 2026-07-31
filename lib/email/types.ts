/**
 * Email templates the app can send. The name is stored on the outbox row, so
 * adding a case here is additive: old rows keep rendering with the payload they
 * were enqueued with.
 */
export type EmailTemplate =
  | "booking_confirmed"
  | "payment_receipt"
  | "waitlisted"
  | "waitlist_promoted"
  | "balance_reminder"
  | "damage_deposit_refunded";

/** Everything a template may need. Stored as jsonb, so keep it flat and plain. */
export interface EmailPayload {
  firstName?: string;
  reference?: string;
  tripName?: string;
  tripDates?: string;
  /** Integer pence, like everywhere else. Never a float. */
  amountPaid?: number;
  balance?: number;
  damageDeposit?: number;
  tripCost?: number;
  balanceDueDate?: string;
  kind?: "deposit" | "balance" | "full";
  ticketsUrl?: string;
  withheld?: number;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface EmailMessage extends RenderedEmail {
  to: string;
}

/**
 * An adapter reports whether it actually delivered. `false` (or a throw) leaves
 * the row for retry; the log adapter returns false deliberately so nothing is
 * ever marked sent when no mail left the building - the exact bug that made the
 * CRM outbox lie about seven rows.
 */
export interface EmailAdapter {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
  /** False when the adapter is inert, so the drain leaves rows queued. */
  readonly delivers: boolean;
}
