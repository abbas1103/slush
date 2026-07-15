import { redirect } from "next/navigation";
import { requireAdmin, sessionAal } from "@/lib/auth/guards";
import { sanitizeNext } from "@/lib/auth/next-url";
import { Card } from "@/components/ui/Card";
import { MfaChallenge } from "@/components/admin/MfaChallenge";

/**
 * Per-sign-in TOTP challenge. Role-gated only (NOT requireAdminMfa) so an aal1
 * admin can reach it. Redirects out if there's nothing to do here.
 */
export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  await requireAdmin();
  const { currentLevel, nextLevel } = await sessionAal();
  if (currentLevel === "aal2") redirect("/admin"); // already verified this session
  if (nextLevel !== "aal2") redirect("/admin/security"); // no factor → enrol first

  const sp = await searchParams;
  const next = sanitizeNext(sp.next, "/admin");

  return (
    <div className="mx-auto max-w-[440px]">
      <h1>Verify it’s you</h1>
      <p className="mt-1 text-[15px] text-soft">
        Two-factor authentication is required for the admin area.
      </p>
      <Card className="mt-6" padding="lg">
        <MfaChallenge next={next} />
      </Card>
    </div>
  );
}
