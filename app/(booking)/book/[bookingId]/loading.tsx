/**
 * Loading skeleton for the booking steps. Stands in for the two-column step
 * shell every step under [bookingId] renders, so a tap gives immediate feedback
 * instead of leaving the previous screen up for the whole server round trip.
 * Deliberately generic - it covers extras, details, payment and confirmation.
 */
export default function BookingStepLoading() {
  return (
    <div className="mx-auto max-w-[1120px] px-6 py-8">
      <p role="status" className="sr-only">
        Loading your booking…
      </p>
      <div aria-hidden className="grid gap-8 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <div className="h-8 w-2/3 animate-pulse rounded-btn bg-track" />
          <div className="h-40 animate-pulse rounded-card border border-line bg-surface" />
          <div className="h-56 animate-pulse rounded-card border border-line bg-surface" />
        </div>
        <div className="h-72 animate-pulse rounded-card border border-line bg-surface" />
      </div>
    </div>
  );
}
