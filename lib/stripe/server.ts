import "server-only";
import Stripe from "stripe";

/** Server-side Stripe client. Secret key is server-only (never NEXT_PUBLIC_). */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder");
