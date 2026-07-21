import Link from "next/link";
import { requireAdmin, sessionAal } from "@/lib/auth/guards";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { buttonVariants } from "@/components/ui/Button";
import { MfaEnroll } from "@/components/admin/MfaEnroll";

/**
 * Admin two-factor setup. Role-gated only (NOT requireAdminMfa) so an admin
 * without a factor can reach it - that's the whole point. Shows enrolment when
 * there's no factor, otherwise the current status.
 */
export default async function AdminSecurityPage() {
  await requireAdmin();
  const { currentLevel, nextLevel } = await sessionAal();
  const hasFactor = currentLevel === "aal2" || nextLevel === "aal2";

  return (
    <div className="mx-auto max-w-[560px]">
      <h1>Admin security</h1>
      <p className="mt-1 text-[15px] text-soft">
        Two-factor authentication protects the CMS - bookings, payments, refunds and student data.
      </p>

      <Card className="mt-6" padding="lg">
        {currentLevel === "aal2" ? (
          <div className="flex flex-col items-start gap-3">
            <Pill variant="success" dot>
              Two-factor authentication is on
            </Pill>
            <p className="text-[14px] text-ink-2">
              Your session is fully verified. You’ll be asked for a code from your authenticator
              app each time you sign in.
            </p>
            <Link href="/admin" className={buttonVariants({ variant: "dark" })}>
              Back to admin
            </Link>
          </div>
        ) : hasFactor ? (
          <div className="flex flex-col items-start gap-3">
            <Pill variant="success" dot>
              Two-factor authentication is set up
            </Pill>
            <p className="text-[14px] text-ink-2">
              Enter a code from your authenticator app to unlock the CMS for this session.
            </p>
            <Link href="/admin/mfa" className={buttonVariants({ variant: "dark" })}>
              Enter code
            </Link>
          </div>
        ) : (
          <>
            <h2 className="mb-1">Set up your authenticator</h2>
            <p className="mb-4 text-[13px] text-soft">
              Required before you can manage trips, bookings or payments.
            </p>
            <MfaEnroll />
          </>
        )}
      </Card>

      <p className="mt-4 text-[12.5px] text-soft">
        Set this up the moment your admin access is granted - until you enrol, a password alone can
        reach the CMS. Lost your device? Contact the SLUSH owner - they can reset your second factor
        so you can set it up again.
      </p>
    </div>
  );
}
