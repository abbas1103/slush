"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { grantStaffRole, revokeStaffRole, type StaffMember, type StaffRole } from "@/app/admin/staff/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";

const ROLE_HELP: Record<StaffRole, string> = {
  admin: "Full CMS access, including every student's passport, date of birth and medical needs.",
  rep: "Trip staff. Intended for ticket scanning only - grants nothing until that is built.",
};

export function StaffManager({
  staff,
  currentUserId,
}: {
  staff: StaffMember[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("rep");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Removing access is a two-step: a mis-click that silently drops an admin is
  // worse than one extra tap.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function add() {
    if (!email.trim()) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const r = await grantStaffRole(email, role);
      if (!r.ok) return setErr(r.error);
      setNotice(`${email.trim()} is now ${role === "admin" ? "an admin" : "a rep"}.`);
      setEmail("");
      router.refresh();
    } catch {
      setErr("Could not grant the role. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    setErr(null);
    setNotice(null);
    try {
      const r = await revokeStaffRole(id);
      setConfirmingId(null);
      if (!r.ok) return setErr(r.error);
      setNotice("Access removed and their sessions ended.");
      router.refresh();
    } catch {
      setConfirmingId(null);
      setErr("Could not remove access. Reload and check whether it took effect.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div>
          <div className="text-[13px] font-semibold">Give someone access</div>
          <p className="mt-1 text-[12.5px] text-soft">
            They need a SLUSH account first - the role is attached to their account, not to the email
            address, so it cannot be claimed later by whoever registers it.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="rep@university.ac.uk"
            aria-label="Email address"
            className="flex-1"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            aria-label="Role"
            className="rounded-btn border border-line bg-surface px-3 py-2 text-[15px]"
          >
            <option value="rep">Rep</option>
            <option value="admin">Admin</option>
          </select>
          <Button variant="dark" onClick={add} disabled={busy}>
            {busy ? "Saving…" : "Grant access"}
          </Button>
        </div>
        <p className="text-[12.5px] text-soft">{ROLE_HELP[role]}</p>
        {err && (
          <p role="alert" className="text-[13px] text-err">
            {err}
          </p>
        )}
        {notice && (
          <p role="status" className="text-[13px] text-ok">
            {notice}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="text-[13px] font-semibold">
          Who has access {staff.length > 0 && <span className="text-soft">({staff.length})</span>}
        </div>
        <div className="flex flex-col gap-2">
          {staff.map((s) => (
            <div key={s.id} className="rounded-btn border border-line px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14px] font-medium">{s.email}</span>
                    <Pill variant={s.role === "admin" ? "error" : "tag"}>{s.role}</Pill>
                    {/* An account with a privileged role and no second factor is a
                        password away from the CMS. Worth seeing at a glance. */}
                    {!s.mfaEnrolled && <Pill variant="error">no 2FA</Pill>}
                    {s.id === currentUserId && <Pill variant="tag">you</Pill>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-soft">
                    {s.lastSignInAt
                      ? `Last signed in ${new Date(s.lastSignInAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                      : "Never signed in"}
                  </div>
                </div>
                {s.id !== currentUserId && (
                  <Button
                    size="sm"
                    variant="out"
                    onClick={() => setConfirmingId(confirmingId === s.id ? null : s.id)}
                    disabled={revokingId === s.id}
                  >
                    Remove access
                  </Button>
                )}
              </div>
              {confirmingId === s.id && (
                <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line-2 pt-2">
                  <span className="text-[12.5px] text-soft">
                    Remove {s.role} access for {s.email} and sign them out everywhere?
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => revoke(s.id)} disabled={revokingId === s.id}>
                      {revokingId === s.id ? "Removing…" : "Yes, remove"}
                    </Button>
                    <Button size="sm" variant="out" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {staff.length === 0 && <p className="text-[13px] text-soft">Nobody has a staff role yet.</p>}
        </div>
      </Card>
    </div>
  );
}
