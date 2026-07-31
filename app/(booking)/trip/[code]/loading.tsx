/**
 * Loading skeleton for the trip page, mirroring its two-column shell
 * (`mx-auto grid max-w-[1120px] ... xl:grid-cols-[1fr_360px]`).
 *
 * This is the first screen a student sees after typing their trip code, so the
 * gap it fills is the one that reads as "did the button work?". The page resolves
 * the code through an RPC and then reads the trip, its extras and the
 * effective-full flag, so there is always a round trip to cover.
 */
export default function TripLoading() {
  return (
    <div className="mx-auto grid max-w-[1120px] gap-8 px-6 py-8 xl:grid-cols-[1fr_360px]">
      <p role="status" className="sr-only">
        Loading your trip…
      </p>
      <div aria-hidden className="flex min-w-0 flex-col gap-4">
        <div className="h-9 w-3/4 animate-pulse rounded-btn bg-track" />
        <div className="h-5 w-1/2 animate-pulse rounded-btn bg-track" />
        <div className="h-48 animate-pulse rounded-card border border-line bg-surface" />
        <div className="h-64 animate-pulse rounded-card border border-line bg-surface" />
      </div>
      <div aria-hidden className="h-80 animate-pulse rounded-card border border-line bg-surface" />
    </div>
  );
}
