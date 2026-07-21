import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

/**
 * Service-role Supabase client - BYPASSES RLS. Server-only (the `server-only`
 * import fails the build if this is ever pulled into client code). Use ONLY for
 * privileged writes after verifying ownership in code: the Stripe webhook,
 * booking mutations the client can't do directly, admin actions, GDPR jobs.
 * The secret key must never carry a NEXT_PUBLIC_ prefix.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
