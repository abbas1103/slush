import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";

/**
 * 404 boundary for the booking steps: a booking id that doesn't exist, or one
 * that belongs to another account (RLS returns nothing either way, and we don't
 * distinguish the two). Keeps the student inside the app chrome.
 */
export default function BookingStepNotFound() {
  return (
    <div className="mx-auto max-w-[1120px] px-6 py-16 text-center">
      <h1>We couldn&apos;t find that booking</h1>
      <p className="mx-auto mt-2 max-w-[440px] text-soft">
        This link may have expired, or it may belong to a different account. Any booking you&apos;ve
        started or paid for is listed in your dashboard.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/dashboard" className={buttonVariants({ variant: "dark" }) + " inline-flex"}>
          Go to my dashboard →
        </Link>
        <Link href="/trip" className={buttonVariants({ variant: "out" }) + " inline-flex"}>
          Enter a trip code
        </Link>
      </div>
    </div>
  );
}
