/**
 * PaymentIntent statuses that are safe to cancel.
 *
 * Deliberately excludes `processing` and `succeeded`: money may already be
 * moving, and cancelling under either would race the webhook that writes the
 * ledger. Shared rather than duplicated, because two copies of this list would
 * eventually disagree and the disagreement would be a double-charge or a
 * cancelled-but-paid booking.
 */
export const CANCELABLE_PI: ReadonlySet<string> = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
]);
