"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe/client";
import { createPaymentIntent } from "@/app/(booking)/book/actions";
import type { Pricing } from "@/lib/pricing/compute";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { OptionRow } from "@/components/ui/OptionRow";
import { Money } from "@/components/ui/Money";
import { SummarySidebar } from "./SummarySidebar";

const stripePromise = getStripe();

function CheckoutForm({ bookingId, amount }: { bookingId: string; amount: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/book/${bookingId}/confirmation`,
      },
      redirect: "if_required",
    });
    if (error) {
      setError(error.message ?? "Payment failed. Please try again.");
      setSubmitting(false);
      return;
    }
    // No redirect needed (e.g. non-3DS card) — go to confirmation; the webhook
    // finalises the booking, and the confirmation page waits for it.
    router.push(`/book/${bookingId}/confirmation`);
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement />
      {error && <p className="mt-3 text-[13px] text-err">{error}</p>}
      <Button type="submit" className="mt-4 w-full" disabled={!stripe || submitting}>
        {submitting ? "Processing…" : (
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
}: {
  bookingId: string;
  pricing: Pricing;
  balanceDueLabel: string;
  tripName: string;
  tripMeta: string;
}) {
  const [mode, setMode] = useState<"deposit" | "full">("deposit");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = mode === "deposit" ? pricing.depositToday : pricing.payInFullToday;

  useEffect(() => {
    let active = true;
    setClientSecret(null);
    setError(null);
    createPaymentIntent(bookingId, mode).then((r) => {
      if (!active) return;
      if (r.ok) setClientSecret(r.clientSecret);
      else setError(r.error);
    });
    return () => {
      active = false;
    };
  }, [bookingId, mode]);

  return (
    <div className="mx-auto grid max-w-[1120px] gap-8 px-6 py-8 xl:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <div>
          <h1>Pay your deposit</h1>
          <p className="mt-2 text-[15px] text-soft">
            Secure your place with a <Money pence={pricing.depositToday} stripZeros /> deposit —{" "}
            <Money pence={pricing.damageDeposit} stripZeros /> of it a refundable damage deposit. Pay
            the rest any time before {balanceDueLabel}.
          </p>
        </div>

        <Card>
          <h3 className="mb-3">How much to pay today</h3>
          <div className="flex flex-col gap-2.5">
            <OptionRow
              title="Pay deposit now"
              desc={
                <>
                  <Money pence={pricing.downpayment} stripZeros /> downpayment +{" "}
                  <Money pence={pricing.damageDeposit} stripZeros /> refundable damage deposit
                </>
              }
              price={<Money pence={pricing.depositToday} />}
              selected={mode === "deposit"}
              onClick={() => setMode("deposit")}
            />
            <OptionRow
              title="Pay in full"
              desc="Whole trip + refundable damage deposit"
              price={<Money pence={pricing.payInFullToday} />}
              selected={mode === "full"}
              onClick={() => setMode("full")}
            />
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3>Payment details</h3>
            <span className="text-[12.5px] text-soft">🔒 Secured by Stripe</span>
          </div>
          {error ? (
            <div className="rounded-btn bg-errbg px-3 py-2 text-[13px] text-err">{error}</div>
          ) : clientSecret ? (
            <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret }}>
              <CheckoutForm bookingId={bookingId} amount={amount} />
            </Elements>
          ) : (
            <p className="text-[13px] text-soft">Loading secure payment…</p>
          )}
        </Card>
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start">
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
    </div>
  );
}
