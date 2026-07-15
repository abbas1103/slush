import { requireUser } from "@/lib/auth/guards";
import { TopNav } from "@/components/chrome/TopNav";
import { Footer } from "@/components/chrome/Footer";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("/dashboard");
  return (
    <div className="flex min-h-dvh flex-col">
      <TopNav user={user} pills />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
