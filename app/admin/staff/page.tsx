import type { Metadata } from "next";
import { requireAdminMfa } from "@/lib/auth/guards";
import { listStaff } from "./actions";
import { StaffManager } from "@/components/admin/StaffManager";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Staff access - SLUSH admin", robots: { index: false, follow: false } };

export default async function StaffPage() {
  // Second factor required: this screen grants the ability to read every
  // student's passport and medical needs.
  const actor = await requireAdminMfa();
  const staff = await listStaff();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1>Staff access</h1>
        <p className="mt-1 text-soft">
          Who can sign in to the CMS, and who is trip staff.
        </p>
      </div>

      <Card tone="dark">
        <div className="text-[13px] font-semibold text-white">Admin sees everything</div>
        <p className="mt-1 text-[12.5px] text-white/70">
          An admin can read every student&apos;s passport number, date of birth, emergency contact and
          any medical or access needs they told us about. Give it only to people who need that.
          Seasonal trip staff should be <strong className="text-white">reps</strong>.
        </p>
      </Card>

      <StaffManager staff={staff} currentUserId={actor.id} />

      <Card>
        <div className="text-[13px] font-semibold">Notes</div>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-soft">
          <li>
            Every grant and removal is written to the audit trail, so you can answer who had access
            on a given date after the season.
          </li>
          <li>
            Removing access ends their sessions immediately rather than waiting for their sign-in to
            expire.
          </li>
          <li>
            The <strong>rep</strong> role currently grants nothing on its own - it exists so trip
            staff can be assigned and audited ahead of ticket scanning being built.
          </li>
          <li>
            Grant a role only when the person can set up their authenticator straight away, in a
            session you trust. A privileged account without a second factor is one password away
            from the CMS.
          </li>
        </ul>
      </Card>
    </div>
  );
}
