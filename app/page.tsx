import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/guards";
import { buttonVariants } from "@/components/ui/Button";

/** Signed-in → dashboard; signed-out → a simple log-in CTA. */
export default async function Home() {
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1>SLUSH</h1>
      <p className="text-soft">Student Led Uni Ski Holidays.</p>
      <Link href="/login" className={buttonVariants({ variant: "dark" })}>
        Log in
      </Link>
    </main>
  );
}
