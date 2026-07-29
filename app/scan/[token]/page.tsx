import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/guards";
import { resolveTicketToken } from "@/lib/db/tickets";
import { ScanResult } from "@/components/admin/ScanResult";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Ticket scan - SLUSH",
  robots: { index: false, follow: false },
};

// Never cached: the answer depends on live booking status and the scan log.
export const dynamic = "force-dynamic";

/**
 * The scanner's landing page. A student's QR encodes /scan/<token>, so a rep
 * points their phone camera at it, taps the link and arrives here.
 *
 * Staff only. Anyone can reach this URL - the token is on a screen in a lift
 * queue and can be photographed - so the security is that resolving it to a
 * booking requires a staff session. A student who scans a friend's ticket is
 * redirected to their own dashboard by requireStaff().
 *
 * Rendering is READ ONLY. The scan is recorded by an explicit action, so a
 * refresh or a back button cannot consume one.
 */
export default async function ScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Pass the full path so a lapsed session returns here after sign-in rather than
  // dropping the token. This is why it is in the path and not a fragment.
  await requireStaff(`/scan/${token}`);

  const view = await resolveTicketToken(token);

  if (view.outcome === "unknown_token" || !view.ticket) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-16 text-center">
        <div className="rounded-card bg-panel p-6 text-white">
          <div className="text-[22px] font-extrabold">Not recognised</div>
          <p className="mt-2 text-[13px] text-white/70">
            This isn&apos;t a SLUSH ticket, or it has been reissued. Check the booking reference
            against the manifest instead.
          </p>
        </div>
        <Link href="/admin" className={buttonVariants({ variant: "out" }) + " mt-4 inline-flex"}>
          Back to admin
        </Link>
      </div>
    );
  }

  return <ScanResult token={token} outcome={view.outcome} ticket={view.ticket} />;
}
