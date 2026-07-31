"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe/client";
import { createPaymentIntent, reconcilePayment } from "@/app/(booking)/book/actions";
import type { Pricing } from "@/lib/pricing/compute";
import { Card } from "@/components/ui/Card";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { OptionRow } from "@/components/ui/OptionRow";
import { Money } from "@/components/ui/Money";
import { SummarySidebar } from "./SummarySidebar";

const stripePromise = getStripe();

type PayMode = "deposit" | "full";

// Each createPaymentIntent cancels the booking's previous intent and mints a new
// one, so a quick deposit → full → deposit tap must not fire three of them
// (audit #29/#75): wait for the choice to settle first.
const MODE_DEBOUNCE_MS = 350;

function CheckoutForm({ bookingId, amount, piId }: { bookingId: string; amount: number; piId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "submitting" | "paid">("idle");
  const [error, setError] = useState<string | null>(null);
  // A final confirm at the point of payment. The declarations on the details step
  // are still the mandatory legal consent (and are enforced server-side - you
  // cannot reach this page without them); this is the last-look tick before money
  // moves, so the amount and the terms are agreed on the same screen.
  const [agreed, setAgreed] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || phase !== "idle" || !agreed) return;
    setPhase("submitting");
    setError(null);
    try {
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/book/${bookingId}/confirmation`,
        },
        redirect: "if_required",
      });
      if (confirmError) {
        setError(confirmError.message ?? "Payment failed. Please try again.");
        setPhase("idle");
        return;
      }
    } catch {
      // Stripe.js itself failed (offline, blocked script) so nothing was
      // confirmed - re-enable the button instead of freezing it.
      setError("We couldn't reach the payment provider. Please check your connection and try again.");
      setPhase("idle");
      return;
    }
    // The card has been charged. Nothing below may keep the student from their
    // confirmation, so show the paid state first: if the reconcile or the
    // navigation fails they still get told what happened, and a link (audit #6).
    setPhase("paid");
    try {
      // Inline success (e.g. non-3DS card): reconcile now so the confirmation page
      // reflects it immediately, without waiting on the webhook. Redirect methods
      // (3DS, Amazon Pay) return to /confirmation where PaymentReturn reconciles.
      await reconcilePayment(bookingId, piId);
    } catch {
      // Transport failure after the charge - the webhook is the canonical writer
      // and /confirmation keeps checking until it lands.
    }
    router.push(`/book/${bookingId}/confirmation`);
  }

  if (phase === "paid") {
    return (
      <div>
        <p className="text-[13px] text-ink-2">
          Payment received - taking you to your confirmation…
        </p>
        <Link
          href={`/book/${bookingId}/confirmation`}
          className={buttonVariants({ variant: "out" }) + " mt-3 w-full"}
        >
          Go to my confirmation →
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement />
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-err">
          {error}
        </p>
      )}
      <Checkbox
        className="mt-4"
        name="payConfirm"
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
      >
        I confirm my details are correct and accept the{" "}
        <Link href="/terms#booking" target="_blank" rel="noopener" className="underline">
          Booking Conditions
        </Link>
        .
      </Checkbox>
      <Button
        type="submit"
        className="mt-4 w-full"
        disabled={!stripe || phase === "submitting" || !agreed}
      >
        {phase === "submitting" ? "Processing…" : (
          <>🔒 Pay <Money pence={amount} stripZeros /></>
        )}
      </Button>
    </form>
  );
}

export function PaymentPanel({
  bookingId,
  pricing,
  balanceDueLabel,
  tripName,
  tripMeta,
  isWaitlist = false,
  initialDeposit,
}: {
  bookingId: string;
  pricing: Pricing;
  balanceDueLabel: string;
  tripName: string;
  tripMeta: string;
  /** True when the server reserved a waiting-list spot rather than a place. */
  isWaitlist?: boolean;
  /**
   * The deposit intent the PAGE already minted during its render, so the card
   * form can mount on first paint instead of after a round trip (see the payment
   * page). Carries the error instead when that failed, so the panel shows the
   * same message and Try again it always did.
   */
  initialDeposit?: { clientSecret: string | null; error: string | null };
}) {
  const [chosenMode, setChosenMode] = useState<PayMode>("deposit");
  const [attempt, setAttempt] = useState(0);
  // Seeded from the server so the first render already has a secret. The key must
  // match the one derived below for attempt 0 in deposit mode, or this is ignored
  // and the effect fetches as before.
  const [result, setResult] = useState<{
    key: string;
    clientSecret: string | null;
    error: string | null;
  } | null>(
    initialDeposit
      ? {
          key: `${bookingId}|deposit|0`,
          clientSecret: initialDeposit.clientSecret,
          error: initialDeposit.error,
        }
      : null,
  );

  // A waiting-list booking pays the refundable deposit only - never the whole
  // trip for a place that may never open (audit #17).
  const mode: PayMode = isWaitlist ? "deposit" : chosenMode;
  const amount = mode === "deposit" ? pricing.depositToday : pricing.payInFullToday;

  // The intent is tied to the request that asked for it, and the panel derives
  // its state from that rather than clearing it in an effect: a mode switch
  // shows the loading state on the very next render, and a late response for a
  // mode the student has moved on from can never mount a card form for the
  // wrong amount (audit #29).
  const key = `${bookingId}|${mode}|${attempt}`;
  const current = result && result.key === key ? result : null;

  const inFlight = useRef<Promise<void> | null>(null);
  // Whether a request has already been made for this panel. Starts true when the
  // server seeded us, so the debounce applies from the very first mode switch -
  // there is no longer a "first load" that needs to be instant.
  const requested = useRef(!!initialDeposit);
  /**
   * The one key the server already answered. Consumed on the first effect run so
   * the panel does not immediately re-request what it was handed. Only that key:
   * a mode switch, a switch back, or a retry all bump the key and fetch normally,
   * which they must - flipping to pay-in-full CANCELS the deposit intent, so the
   * seeded secret is dead the moment the student changes their mind.
   */
  const seededKey = useRef<string | null>(initialDeposit ? `${bookingId}|deposit|0` : null);

  useEffect(() => {
    let stale = false;
    // Already answered server-side: consume the seed and skip this round trip.
    if (seededKey.current === key) {
      seededKey.current = null;
      return;
    }
    // First load is immediate; later switches wait for the choice to settle.
    const timer = setTimeout(() => {
      requested.current = true;
      // Chain onto any request still in the air so this booking only ever has
      // one create/cancel pair running at a time.
      const run = (inFlight.current ?? Promise.resolve())
        .then(() => (stale ? null : createPaymentIntent(bookingId, mode)))
        .then((r) => {
          if (stale || !r) return;
          setResult({
            key,
            clientSecret: r.ok ? r.clientSecret : null,
            error: r.ok ? null : r.error,
          });
        })
        .catch(() => {
          if (stale) return;
          setResult({
            key,
            clientSecret: null,
            error: "We couldn't set up your payment - please check your connection and try again.",
          });
        });
      inFlight.current = run;
    }, requested.current ? MODE_DEBOUNCE_MS : 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [bookingId, mode, key]);

  return (
    <div className="mx-auto grid max-w-[1120px] gap-x-8 gap-y-4 px-6 py-8 xl:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4 xl:col-start-1 xl:row-start-1">
        <div>
          <h1>{isWaitlist ? "Pay your waiting-list deposit" : "Pay your deposit"}</h1>
          {isWaitlist ? (
            <p className="mt-2 text-[15px] text-soft">
              This trip is full, so today you pay the{" "}
              <Money pence={pricing.depositToday} stripZeros /> deposit that holds your waiting-list
              spot - <Money pence={pricing.damageDeposit} stripZeros /> of it a refundable damage
              deposit. If a place opens up you&apos;re on the trip and pay the rest before{" "}
              {balanceDueLabel}; if not, we refund the whole{" "}
              <Money pence={pricing.depositToday} stripZeros />.
            </p>
          ) : (
            <p className="mt-2 text-[15px] text-soft">
              Secure your place with a <Money pence={pricing.depositToday} stripZeros /> deposit -{" "}
              <Money pence={pricing.damageDeposit} stripZeros /> of it a refundable damage deposit. Pay
              the rest any time before {balanceDueLabel}.
            </p>
          )}
        </div>

        <Card>
          <h3 className="mb-3">{isWaitlist ? "What you pay today" : "How much to pay today"}</h3>
          <div className="flex flex-col gap-2.5">
            <OptionRow
              title={isWaitlist ? "Waiting-list deposit" : "Pay deposit now"}
              desc={
                <>
                  <Money pence={pricing.downpayment} stripZeros /> downpayment +{" "}
                  <Money pence={pricing.damageDeposit} stripZeros /> refundable damage deposit
                  {isWaitlist ? " - refunded in full if no place opens up" : ""}
                </>
              }
              price={<Money pence={pricing.depositToday} />}
              selected={mode === "deposit"}
              onClick={() => setChosenMode("deposit")}
            />
            {/* Pay-in-full is hidden on a waiting-list booking: the place isn't
                theirs yet, so taking the whole trip cost now would leave us
                holding money we have to hand-refund (audit #17). */}
            {!isWaitlist && (
              <OptionRow
                title="Pay in full"
                desc="Whole trip + refundable damage deposit"
                price={<Money pence={pricing.payInFullToday} />}
                selected={mode === "full"}
                onClick={() => setChosenMode("full")}
              />
            )}
          </div>
        </Card>
      </div>

      {/* The summary sits before the card form in the source order, so below xl -
          where the grid collapses to one column - the itemised total and "Due
          today" are on screen before the Pay button (audit #32). */}
      <aside className="xl:sticky xl:top-20 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start">
        <SummarySidebar pricing={pricing} tripName={tripName} tripMeta={tripMeta}>
          <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[14px]">
            <div className="flex justify-between">
              <span className="text-soft">{mode === "deposit" ? "Downpayment today" : "Trip payment today"}</span>
              <Money pence={mode === "deposit" ? pricing.downpayment : pricing.tripCost} className="font-semibold" />
            </div>
            <div className="flex justify-between">
              <span className="text-soft">Refundable damage deposit</span>
              <Money pence={pricing.damageDeposit} className="font-semibold" />
            </div>
            <div className="flex justify-between">
              <span className="text-soft">Balance after today</span>
              <Money
                pence={mode === "deposit" ? pricing.balanceAfterDeposit : 0}
                className="font-semibold"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-btn bg-panel px-3 py-2.5 text-white">
            <span className="text-[13px]">Due today</span>
            <Money pence={amount} className="font-bold" />
          </div>
        </SummarySidebar>
      </aside>

      <Card className="xl:col-start-1 xl:row-start-2">
        <div className="mb-3 flex items-center justify-between">
          <h3>Payment details</h3>
          <span className="text-[12.5px] text-soft">🔒 Secured by Stripe</span>
        </div>
        {current?.error ? (
          <div>
            <div className="rounded-btn bg-errbg px-3 py-2 text-[13px] text-err">{current.error}</div>
            {/* Without this the panel is a dead end: re-picking the already
                selected option changes nothing, so nothing re-runs (audit #75). */}
            <Button variant="out" className="mt-3 w-full" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : current?.clientSecret ? (
          <Elements
            key={current.clientSecret}
            stripe={stripePromise}
            options={{ clientSecret: current.clientSecret }}
          >
            <CheckoutForm
              bookingId={bookingId}
              amount={amount}
              piId={current.clientSecret.split("_secret")[0]}
            />
          </Elements>
        ) : (
          <p className="text-[13px] text-soft">Loading secure payment…</p>
        )}
      </Card>
    </div>
  );
}
