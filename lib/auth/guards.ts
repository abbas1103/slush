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

/**
 * Require an admin. Redirects non-admins to /dashboard so /admin's existence
 * isn't disclosed. This is the ROLE gate only — the second-factor gate is
 * requireAdminMfa() below. Use this on the enrol/challenge screens (so they
 * stay reachable) and as the base check everywhere.
 */
export async function requireAdmin(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdmin(user)) redirect("/dashboard");
  return user;
}

/**
 * The session's authenticator assurance level. Read from Supabase's MFA API —
 * NOT from the User object (there is no `user.aal` field; the JWT carries the
 * claim but the client SDK exposes it here). `currentLevel` is this session's
 * level; `nextLevel` is the highest level the user *could* reach (aal2 iff they
 * have a verified factor).
 */
export async function sessionAal(): Promise<{
  currentLevel: string | null;
  nextLevel: string | null;
}> {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    currentLevel: data?.currentLevel ?? null,
    nextLevel: data?.nextLevel ?? null,
  };
}

/**
 * Require an admin who has completed a second factor this session (aal2). This
 * is the real security boundary for the CMS — apply it to every admin page and
 * every admin server action (admin writes use the service-role client, so RLS
 * can't enforce this; the guard must). Redirects, in order:
 *   - not logged in / not admin  → handled by requireAdmin()
 *   - admin, no verified factor  → /admin/security (enrol)
 *   - admin, factor not challenged this session → /admin/mfa (challenge)
 *   - admin at aal2              → allowed
 */
export async function requireAdminMfa(): Promise<User> {
  const user = await requireAdmin();
  const { currentLevel, nextLevel } = await sessionAal();
  if (currentLevel === "aal2") return user;
  // nextLevel === 'aal2' means a verified factor exists but this session is
  // still aal1 → challenge. Otherwise there's no factor yet → enrol.
  redirect(nextLevel === "aal2" ? "/admin/mfa" : "/admin/security");
}
