import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";

/**
 * 404 boundary for the booking area. Renders inside the SLUSH chrome (nav +
 * footer) with a way back in, instead of Next's unstyled system 404. Covers a
 * trip code that has expired or been typed wrong.
 */
export default function BookingNotFound() {
  return (
    <div className="mx-auto max-w-[1120px] px-6 py-16 text-center">
      <h1>We couldn&apos;t find that page</h1>
      <p className="mx-auto mt-2 max-w-[440px] text-soft">
        The link may have expired, or the trip code may no longer be active. Your trip organiser can
        give you a fresh code.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/trip" className={buttonVariants({ variant: "dark" }) + " inline-flex"}>
          Enter a trip code →
        </Link>
        <Link href="/dashboard" className={buttonVariants({ variant: "out" }) + " inline-flex"}>
          Go to my dashboard
        </Link>
      </div>
    </div>
  );
}
