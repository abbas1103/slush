import Link from "next/link";
import { getUser } from "@/lib/auth/guards";
import { buttonVariants } from "@/components/ui/Button";

/**
 * Root. Signed-out → a simple log-in CTA. Signed-in → a placeholder home until
 * the trip-code screen + dashboard land in later slices.
 */
export default async function Home() {
  const user = await getUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1>SLUSH</h1>
      {user ? (
        <>
          <p className="text-soft">
            Signed in as {user.email}. The trip-code screen and booking flow
            arrive in the next slice.
          </p>
          <div className="flex items-center gap-3">
            <Link href="/dev/components" className={buttonVariants({ variant: "out" })}>
              Component library
            </Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className={buttonVariants({ variant: "dark" })}>
                Log out
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <p className="text-soft">Student Led Uni Ski Holidays.</p>
          <Link href="/login" className={buttonVariants({ variant: "dark" })}>
            Log in
          </Link>
        </>
      )}
    </main>
  );
}
