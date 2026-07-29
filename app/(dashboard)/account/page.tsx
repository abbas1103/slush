import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/guards";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "My details - SLUSH",
  // Signed-in surface: never index it, and don't follow links out of it.
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const user = await requireUser("/account");
  return (
    <div className="mx-auto max-w-[640px] px-6 py-10">
      <h1>My details</h1>
      <Card className="mt-6">
        <div className="text-[13px] text-soft">Signed in as</div>
        {/* An email has no default break opportunity, so it must break-all or it
            overflows the card and gives the whole page horizontal scroll. */}
        <div className="break-all text-[15px] font-semibold">{user.email}</div>
        <p className="mt-3 text-[13px] text-soft">
          You enter your booking details during checkout. To change them, or to ask for a copy of
          your data or its deletion, email us and we&apos;ll take care of it.
        </p>
        <form action="/auth/signout" method="post" className="mt-4">
          <button type="submit" className={buttonVariants({ variant: "out" })}>
            Log out
          </button>
        </form>
      </Card>
    </div>
  );
}
