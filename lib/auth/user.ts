import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The verified session user, read at most ONCE per request.
 *
 * `supabase.auth.getUser()` is not a local decode - `@supabase/auth-js` issues a
 * `GET /auth/v1/user` on every single call, with no caching of its own. Because
 * an async layout blocks its children until it resolves, the call sites stacked
 * up serially: a `/book/<id>/details` render paid FIVE sequential round trips to
 * the Auth server (proxy, the booking layout, the book layout, getBookingContext,
 * and the page's own read) before fetching a single row. Measured against the
 * live deployment, the whole function budget for a page with no Supabase calls is
 * only 30-70ms, so that waterfall dominated TTFB.
 *
 * React's `cache()` dedupes across one render pass, which is exactly the scope
 * that contains every layout and the page. This is a latency fix, NOT a relaxed
 * check: the JWT is still verified against the Auth server on every request, and
 * every guard still authorises on the result. It is deliberately never
 * `getSession()` (CLAUDE.md), which would skip verification entirely.
 *
 * This module intentionally does NOT import `next/navigation`. The redirecting
 * guards live in `./guards`; keeping the bare read separate lets the query layer
 * (`lib/db/queries.ts`) share the cache without pulling `redirect()` in with it.
 *
 * Scope note: `cache()` is per-request, so it cannot dedupe the `proxy.ts` call -
 * middleware runs in a separate pass, and that call must stay regardless because
 * it is what refreshes an expiring session.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
