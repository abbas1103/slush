import "server-only";
import Stripe from "stripe";

/**
 * Server-side Stripe client. Secret key is server-only (never NEXT_PUBLIC_).
 *
 * Both Stripe secrets are resolved at module load and **fail closed** when they
 * are missing (audit #106, #114). The old `?? "sk_test_placeholder"` let a
 * misconfigured production deploy boot healthy, render the whole booking flow,
 * and then show a student Stripe's raw "Invalid API Key provided: sk_test_***"
 * at the moment they tried to pay. The webhook secret is checked here too
 * because it is what makes a charge recordable: with no signing secret every
 * delivery is rejected, so refunds and disputes are silently dropped - we must
 * not be able to take money we cannot reconcile.
 *
 * The one exception is `next build`, which evaluates route modules with no
 * runtime secrets (CI builds from three NEXT_PUBLIC placeholders - see
 * .github/workflows/ci.yml), so during the build phase only we fall back to
 * inert placeholders. Anything that actually serves a request - `next dev`,
 * `next start`, Vercel's runtime - has NEXT_PHASE unset or set to a server
 * phase, and so throws immediately with the variable's name.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function requireStripeSecret(
  name: "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET",
  buildPlaceholder: string,
): string {
  const value = process.env[name];
  if (value) return value;
  if (isBuildPhase) return buildPlaceholder;
  throw new Error(`${name} is not set - refusing to start Stripe with a placeholder`);
}

export const stripe = new Stripe(requireStripeSecret("STRIPE_SECRET_KEY", "sk_test_placeholder"));

/**
 * Webhook signing secret, verified at module load. Import this in the webhook
 * route instead of reading the env var there: a missing secret then fails the
 * module (HTTP 5xx, which Stripe retries and Sentry reports) rather than 400ing
 * every delivery for good.
 */
export const stripeWebhookSecret = requireStripeSecret(
  "STRIPE_WEBHOOK_SECRET",
  "whsec_placeholder",
);
