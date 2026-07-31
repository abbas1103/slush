import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/**
 * Receives the tiny error envelope from `lib/observability/report.ts` and reports
 * it through the SERVER Sentry SDK.
 *
 * This exists because the Sentry BROWSER SDK was ~150 KB gzipped in the chunk
 * every route loads eagerly (the four client error boundaries imported it, and
 * boundaries live in the root layout tree). Its bundleSizeOptimizations flags are
 * no-ops under Turbopack, so the SDK could not be slimmed - only removed. This
 * keeps the signal at a fraction of a percent of the weight.
 *
 * Trust model: the endpoint is unauthenticated by necessity, because a boundary
 * can fire before a session exists or when auth itself is what broke. So nothing
 * in the body is trusted. It is length-capped, re-scrubbed, `.strict()`-parsed,
 * rate-limited per IP, and tagged as client-reported so an operator never mistakes
 * it for a server-observed stack.
 */

export const dynamic = "force-dynamic";

/** Hard ceiling on the raw body. A legitimate envelope is a few hundred bytes. */
const MAX_BODY_BYTES = 2048;

const reportSchema = z
  .object({
    message: z.string().min(1).max(300),
    // React's production digest: hex, and short. Anything else is not a digest.
    digest: z
      .string()
      .regex(/^[a-f0-9]{1,32}$/i)
      .optional(),
    // Path only, never a full URL: no query string, no host, no fragment. The
    // `..` exclusion is not about file access (this value only ever becomes a
    // Sentry tag) but about not forwarding an obviously forged path as though it
    // were a route of ours - and about not accepting junk from a public endpoint.
    pathname: z
      .string()
      .max(200)
      .regex(/^\/(?!.*\.\.)[A-Za-z0-9\-._~/]*$/),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Always 204, whatever happens. A reporting endpoint that returns detail is a
  // probe for what our validation accepts, and the browser ignores the body.
  const ok = () => new NextResponse(null, { status: 204 });

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return ok();

    const parsed = reportSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return ok();

    if (!(await rateLimit("clientError", await clientIp()))) return ok();

    const { message, digest, pathname } = parsed.data;

    // Reported as a message rather than a synthetic Error: there is no real stack
    // to attach, and fabricating one would put this file's frames on every event.
    Sentry.captureMessage(`[client] ${message}`, {
      level: "error",
      tags: { source: "client-boundary", ...(digest ? { digest } : {}) },
      extra: { pathname },
    });
  } catch {
    // Malformed JSON, a torn-down sendBeacon, a Sentry hiccup: none of it is
    // worth a 5xx on a fire-and-forget reporter.
  }

  return ok();
}
