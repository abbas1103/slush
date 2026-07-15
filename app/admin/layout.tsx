import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Role gate only (proxy.ts gates too; guards never trust middleware alone).
  // The second-factor (aal2) gate is requireAdminMfa(), applied per CMS page +
  // per server action — NOT here, so /admin/security and /admin/mfa stay
  // reachable for an admin who still needs to enrol or challenge.
  await requireAdmin();
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-6">
          <Link href="/admin" className="text-[18px] font-extrabold tracking-tight">
            SLUSH <span className="text-[13px] font-medium text-soft">admin</span>
          </Link>
          <div className="flex items-center gap-5 text-[13px] text-soft">
            <Link href="/admin/security" className="hover:text-ink">
              Security
            </Link>
            <Link href="/" className="hover:text-ink">
              ← Back to site
            </Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className="hover:text-ink">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1120px] px-6 py-8">{children}</main>
    </div>
  );
}
