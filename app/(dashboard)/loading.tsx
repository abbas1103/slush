/**
 * Loading skeleton for the signed-in area (/dashboard, /tickets, /account, /help).
 *
 * These pages all block on a Supabase read before they render anything, and until
 * now a tap left the previous screen up for the whole round trip with no
 * acknowledgement. Deliberately generic across the four, like the booking-step
 * skeleton: a headline bar, then content blocks at the widest page's width.
 *
 * Note what this can and cannot cover. The route-group LAYOUT awaits requireUser()
 * above this boundary, so the skeleton itself cannot paint until auth resolves -
 * a Suspense boundary can't help there. What made this worth adding is that the
 * auth read is now request-cached (lib/auth/user.ts), so that wait is one Auth
 * round trip rather than the two or three it used to be.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1120px] px-6 py-8">
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div aria-hidden>
        <div className="h-8 w-1/3 animate-pulse rounded-btn bg-track" />
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-card border border-line bg-surface"
            />
          ))}
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-6">
            <div className="h-32 animate-pulse rounded-card border border-line bg-surface" />
            <div className="h-56 animate-pulse rounded-card border border-line bg-surface" />
          </div>
          <div className="h-64 animate-pulse rounded-card border border-line bg-surface" />
        </div>
      </div>
    </div>
  );
}
