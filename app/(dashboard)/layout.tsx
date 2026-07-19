import { headers } from "next/headers";
import { requireUser } from "@/lib/auth/guards";
import { TopNav } from "@/components/chrome/TopNav";
import { Footer } from "@/components/chrome/Footer";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Preserve the actual page (/tickets, /account, /help) as the post-login
  // target instead of always bouncing to /dashboard.
  const path = (await headers()).get("x-pathname") ?? "/dashboard";
  const user = await requireUser(path);
  return (
    <div className="flex min-h-dvh flex-col">
      <TopNav user={user} pills />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
