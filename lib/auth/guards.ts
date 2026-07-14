import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Authorization guards. All authorize on `getUser()` (verifies the JWT with the
 * Auth server), never `getSession()`. Call these inside every protected Server
 * Component / Server Action — never rely on middleware alone.
 */

export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Require a logged-in user; otherwise redirect to login preserving destination. */
export async function requireUser(nextPath?: string): Promise<User> {
  const user = await getUser();
  if (!user) {
    redirect(`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`);
  }
  return user;
}

/** Require a verified email — gates money/PII actions, not just login. */
export async function requireVerified(nextPath?: string): Promise<User> {
  const user = await requireUser(nextPath);
  if (!user.email_confirmed_at) {
    redirect("/verify-email");
  }
  return user;
}

/** Role lives in the JWT app_metadata (not self-settable). */
export function isAdmin(user: User | null): boolean {
  return user?.app_metadata?.role === "admin";
}

/** Has the session completed MFA (assurance level aal2)? */
export function hasMfa(user: User | null): boolean {
  // aal is exposed on the AMR/aal claim; Supabase surfaces it via getUser() too.
  return (user as unknown as { aal?: string } | null)?.aal === "aal2";
}

/**
 * Require an admin. Returns 404-style redirect for non-admins so /admin's
 * existence isn't disclosed. MFA (aal2) is additionally enforced on
 * money/PII-affecting admin server actions.
 */
export async function requireAdmin(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdmin(user)) redirect("/dashboard");
  return user;
}
