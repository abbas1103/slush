import { headers } from "next/headers";
import { requireUser } from "@/lib/auth/guards";
import { TopNav } from "@/components/chrome/TopNav";
import { Footer } from "@/components/chrome/Footer";

export default async function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Booking flow requires a logged-in user (defence-in-depth with proxy.ts).
  const path = (await headers()).get("x-pathname") ?? "/trip";
  const user = await requireUser(path);

  return (
    <div className="flex min-h-dvh flex-col">
      <TopNav user={user} />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
