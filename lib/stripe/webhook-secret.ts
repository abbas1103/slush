import "server-only";

/**
 * The Stripe webhook signing secret, resolved and validated at module load.
 *
 * This lives in its OWN module, imported only by app/api/stripe/webhook/route.ts,
 * deliberately. It used to sit alongside the `stripe` client export, and because
 * a module-scope throw fails every importer, a deployment missing only the
 * SIGNING secret took down every server action in the booking flow and the whole
 * CMS - none of which needs it. The blast radius should match the fault: without
 * a signing secret the webhook cannot verify a delivery, so the webhook fails
 * (5xx, which Stripe retries and Sentry reports) and everything else keeps
 * serving.
 *
 * Failing rather than 400ing is the point: a 400 tells Stripe the delivery was
 * rejected and it stops retrying, so events would be lost for good.
 *
 * `next build` evaluates route modules with no runtime secrets (CI builds from
 * three NEXT_PUBLIC placeholders - see .github/workflows/ci.yml), so during the
 * build phase only this falls back to an inert placeholder. Anything serving a
 * request has NEXT_PHASE unset or set to a server phase and throws by name.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function resolve(): string {
  const value = process.env.STRIPE_WEBHOOK_SECRET;
  if (value) return value;
  if (isBuildPhase) return "whsec_placeholder";
  throw new Error(
    "STRIPE_WEBHOOK_SECRET is not set - refusing to accept Stripe webhooks that cannot be verified",
  );
}

export const stripeWebhookSecret = resolve();
