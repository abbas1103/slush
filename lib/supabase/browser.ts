import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";

/**
 * Anon/publishable-key Supabase client for Client Components that need live
 * data or interactive auth (e.g. OAuth sign-in). RLS-enforced.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
