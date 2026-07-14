/**
 * Split-screen auth shell (login / signup / reset): dark brand panel on the
 * left (hidden below the lg breakpoint), form on the right. Mirrors the
 * prototype's .login-wrap.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-panel px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="text-[22px] font-extrabold tracking-tight">SLUSH</div>
        <div className="relative z-10">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">
            ❄ Brumski Christmas Trip · 2026
          </span>
          <h1 className="mt-5 max-w-sm text-[44px] font-extrabold leading-[1.05]">
            Your trip
            <br />
            starts here.
          </h1>
          <p className="mt-4 max-w-sm text-[15px] text-white/70">
            Log in to enter your trip code, build your booking and grab your
            lift pass — all in one place.
          </p>
        </div>
        <svg
          viewBox="0 0 600 200"
          className="pointer-events-none absolute inset-x-0 bottom-0 w-full text-white"
          fill="currentColor"
          aria-hidden
        >
          <path d="M0 200 L120 90 L200 150 L320 40 L420 140 L520 70 L600 130 L600 200 Z" opacity="0.10" />
          <path d="M0 200 L90 130 L180 170 L300 100 L400 175 L520 120 L600 165 L600 200 Z" opacity="0.07" />
        </svg>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">{children}</main>
    </div>
  );
}
