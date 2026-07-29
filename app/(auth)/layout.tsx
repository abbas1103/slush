import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  // Sign-in, sign-up and password-reset pages have nothing to offer a crawler.
  robots: { index: false, follow: false },
};

/**
 * Split-screen auth shell (login / signup / reset): dark brand panel on the
 * left, form on the right. Mirrors the prototype's .login-wrap - below the lg
 * breakpoint the split collapses to a single column and the panel becomes a
 * compact banner above the form (smaller padding and headline, no mountains)
 * rather than disappearing, so phone users still get the wordmark and a route
 * to the legal pages.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-2">
      <aside className="relative flex flex-col gap-6 overflow-hidden bg-panel px-6 py-8 text-white lg:justify-between lg:px-12 lg:py-14">
        <div className="text-[22px] font-extrabold tracking-tight">SLUSH</div>
        <div className="relative z-10">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">
            ❄ Brumski Christmas Trip · 2026
          </span>
          {/* Brand copy, not the page heading - the form's own h1 ("Log in")
              stays the only h1 now that the panel shows on phones too. */}
          <p className="mt-5 max-w-sm text-[28px] font-extrabold leading-[1.05] tracking-[-0.02em] lg:text-[44px]">
            Your trip
            <br />
            starts here.
          </p>
          <p className="mt-4 max-w-sm text-[14px] text-white/70 lg:text-[15px]">
            Log in to enter your trip code, build your booking and grab your
            lift pass - all in one place.
          </p>
        </div>
        <div className="relative z-10 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/60">
          <Link href="/privacy" className="hover:text-white">
            Privacy &amp; cookies
          </Link>
          <Link href="/terms" className="hover:text-white">
            Terms &amp; conditions
          </Link>
        </div>
        <svg
          viewBox="0 0 600 200"
          className="pointer-events-none absolute inset-x-0 bottom-0 hidden w-full text-white lg:block"
          fill="currentColor"
          aria-hidden
        >
          <path d="M0 200 L120 90 L200 150 L320 40 L420 140 L520 70 L600 130 L600 200 Z" opacity="0.10" />
          <path d="M0 200 L90 130 L180 170 L300 100 L400 175 L520 120 L600 165 L600 200 Z" opacity="0.07" />
        </svg>
      </aside>

      <main className="flex flex-1 items-center justify-center px-6 py-12">{children}</main>
    </div>
  );
}
