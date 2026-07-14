import Link from "next/link";

/**
 * Placeholder home. In Slice 2 (auth) this becomes a server-side redirect:
 * logged-in → /dashboard, otherwise → /login.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1>SLUSH</h1>
      <p className="text-soft">
        Student Led Uni Ski Holidays. Foundation scaffolding is in place — the
        booking flow is built slice by slice.
      </p>
      <Link
        href="/dev/components"
        className="rounded-btn bg-ink px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink-hover"
      >
        View component library →
      </Link>
    </main>
  );
}
