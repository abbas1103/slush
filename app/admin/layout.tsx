import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Role gate (proxy.ts gates too; guards never trust middleware alone).
  // NOTE: admin MFA enforcement is added in the hardening slice.
  await requireAdmin();
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-6">
          <Link href="/admin" className="text-[18px] font-extrabold tracking-tight">
            SLUSH <span className="text-[13px] font-medium text-soft">admin</span>
          </Link>
          <Link href="/" className="text-[13px] text-soft hover:text-ink">
            ← Back to site
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1120px] px-6 py-8">{children}</main>
    </div>
  );
}
