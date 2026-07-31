/**
 * Loading skeleton for the CMS. Sits inside the admin layout's `<main>`, which
 * already supplies `mx-auto max-w-[1120px] px-6 py-8`, so this adds no container
 * of its own.
 *
 * Worth more here than on the student pages: every CMS page runs
 * requireAdminMfa() and the trip screens read whole tables with exact counts, so
 * these are the slowest renders in the app. The admin header stays put because it
 * lives in the layout above this boundary.
 */
export default function AdminLoading() {
  return (
    <>
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div aria-hidden>
        <div className="h-8 w-1/4 animate-pulse rounded-btn bg-track" />
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-card border border-line bg-surface"
            />
          ))}
        </div>
      </div>
    </>
  );
}
