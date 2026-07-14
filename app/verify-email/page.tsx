import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";

export default function VerifyEmailPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-okbg text-xl text-ok">
        ✉
      </div>
      <h1>Check your email</h1>
      <p className="text-soft">
        We&apos;ve sent you a confirmation link. Click it to activate your
        account, then log in to book your trip.
      </p>
      <Link href="/login" className={buttonVariants({ variant: "out" })}>
        Back to log in
      </Link>
    </main>
  );
}
