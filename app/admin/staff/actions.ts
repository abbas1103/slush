"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdminMfa } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Staff roles: grant, revoke and list.
 *
 * The role lives in `auth.users.app_metadata.role`, which is writable ONLY with
 * the service role - never `user_metadata`, which the user can write themselves
 * via supabase.auth.updateUser(). A role in user_metadata would let any student
 * promote themselves to admin and read every passport in the database.
 *
 * app_metadata is the single source of truth. There is deliberately no mirror
 * table: two sources for one authorisation fact drift, and the drift always
 * favours the attacker. The list below therefore reads auth.users directly.
 *
 * Every grant and revoke writes an audit_log row. Without one you cannot answer
 * "who had access in December", which is the question that matters after a season.
 */

export type StaffRole = "admin" | "rep";
export type StaffResult = { ok: true } | { ok: false; error: string };

const roleSchema = z.enum(["admin", "rep"]);
// Deliberately permissive on shape - Supabase is the authority on what address it
// holds. This only has to stop obvious nonsense before a lookup.
const emailSchema = z.string().trim().min(3).max(320).email("Enter a valid email address");

export interface StaffMember {
  id: string;
  email: string;
  role: StaffRole;
  lastSignInAt: string | null;
  /** Has this person enrolled a second factor? A staff account without one is a password away from the CMS. */
  mfaEnrolled: boolean;
}

/**
 * Everyone holding a privileged role.
 *
 * Pages through auth.users because the role is a JWT claim, not a column - there
 * is nothing to select from. Fine at this size (hundreds); if the roster ever
 * reaches tens of thousands this wants a mirrored, trigger-maintained table and
 * the drift problem that comes with it.
 */
export async function listStaff(): Promise<StaffMember[]> {
  await requireAdminMfa();
  const admin = createAdminClient();

  const staff: StaffMember[] = [];
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Could not read the user list: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      const role = (u.app_metadata as { role?: unknown } | undefined)?.role;
      if (role !== "admin" && role !== "rep") continue;
      staff.push({
        id: u.id,
        email: u.email ?? "(no email)",
        role,
        lastSignInAt: u.last_sign_in_at ?? null,
        mfaEnrolled: (u.factors ?? []).some((f) => f.status === "verified"),
      });
    }
    if (users.length < perPage) break;
  }
  // Admins first, then alphabetical - the list is read to answer "who can do what".
  return staff.sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === "admin" ? -1 : 1));
}

/**
 * Grant a role to an existing account, found by email.
 *
 * Email is how a human finds the person; the role is attached to their UUID. It
 * is resolved through public.users (citext, mirrored from auth.users by the
 * signup trigger) so the lookup is indexed and case-insensitive.
 *
 * The person must already have an account. Granting a role to an address that
 * has never signed up would mean storing an authorisation against a string that
 * anyone could later register.
 */
export async function grantStaffRole(email: string, role: StaffRole): Promise<StaffResult> {
  const actor = await requireAdminMfa();

  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) {
    return { ok: false, error: parsedEmail.error.issues[0]?.message ?? "Enter a valid email address." };
  }
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return { ok: false, error: "Unknown role." };

  const admin = createAdminClient();
  const { data: found, error: lookupError } = await admin
    .from("users")
    .select("id, email")
    .eq("email", parsedEmail.data)
    .maybeSingle();
  if (lookupError) return { ok: false, error: `Could not look that email up: ${lookupError.message}` };
  if (!found) {
    return {
      ok: false,
      error: "No account with that email. Ask them to sign up first, then grant the role.",
    };
  }

  const { error } = await admin.auth.admin.updateUserById(found.id, {
    app_metadata: { role: parsedRole.data },
  });
  if (error) return { ok: false, error: `Could not set the role: ${error.message}` };

  // Audited AFTER the write, so the message is true about what happened. A failed
  // audit fails the action: an unrecorded privilege grant is not an acceptable state.
  const { error: auditError } = await admin.from("audit_log").insert({
    actor_user_id: actor.id,
    actor_email: actor.email ?? null,
    action: "staff_role_granted",
    target_type: "user",
    target_id: found.id,
    metadata: { role: parsedRole.data, email: found.email },
  });
  if (auditError) {
    return {
      ok: false,
      error: `The role was granted but the audit trail could not be written: ${auditError.message}`,
    };
  }

  revalidatePath("/admin/staff");
  return { ok: true };
}

/**
 * Remove all privileges from an account.
 *
 * Two things beyond clearing the claim:
 *
 * 1. An admin cannot revoke their OWN admin. The role can only be granted from
 *    this screen, which requires admin - so the last admin removing themselves
 *    would lock the CMS with no way back except the Supabase dashboard.
 * 2. Refresh tokens are revoked, so removal is immediate. Clearing app_metadata
 *    alone leaves their existing access token valid until it expires (up to an
 *    hour), which is the wrong behaviour for a lost phone or a dismissal.
 */
export async function revokeStaffRole(userId: string): Promise<StaffResult> {
  const actor = await requireAdminMfa();

  const parsedId = z.string().uuid().safeParse(userId);
  if (!parsedId.success) return { ok: false, error: "Unknown user." };
  if (parsedId.data === actor.id) {
    return {
      ok: false,
      error: "You can't remove your own access - ask another admin, so the CMS is never left with no one.",
    };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("users")
    .select("email")
    .eq("id", parsedId.data)
    .maybeSingle();

  const { error } = await admin.auth.admin.updateUserById(parsedId.data, {
    app_metadata: { role: null },
  });
  if (error) return { ok: false, error: `Could not remove the role: ${error.message}` };

  // Immediate, rather than whenever their current token happens to expire.
  //
  // NOT auth.admin.signOut(): despite the name it takes the user's own JWT ("A
  // valid, logged-in JWT"), which the server does not have - passing a user id
  // there compiles, because both are strings, and fails at runtime. The admin API
  // has no revoke-by-user-id, so this deletes their auth.sessions rows through a
  // service-role-only definer function; refresh tokens cascade with them.
  const { error: signOutError } = await admin.rpc("revoke_user_sessions", {
    p_user_id: parsedId.data,
  });

  const { error: auditError } = await admin.from("audit_log").insert({
    actor_user_id: actor.id,
    actor_email: actor.email ?? null,
    action: "staff_role_revoked",
    target_type: "user",
    target_id: parsedId.data,
    metadata: {
      email: target?.email ?? null,
      // Worth recording: the role is gone either way, but a failed sign-out means
      // their existing token still works until it expires.
      sessions_revoked: !signOutError,
      ...(signOutError ? { sign_out_error: signOutError.message } : {}),
    },
  });
  if (auditError) {
    return {
      ok: false,
      error: `Access was removed but the audit trail could not be written: ${auditError.message}`,
    };
  }

  revalidatePath("/admin/staff");
  if (signOutError) {
    return {
      ok: false,
      error: "Their role was removed, but their current session could not be ended - it will expire within the hour.",
    };
  }
  return { ok: true };
}
