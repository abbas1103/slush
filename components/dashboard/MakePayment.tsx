"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe/client";
import { createBalancePaymentIntent, reconcilePayment } from "@/app/(booking)/book/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { formatPence } from "@/lib/utils/money";

const stripePromise = getStripe();

function BalanceCheckout({
  bookingId,
  amount,
  piId,
  onSuccess,
}: {
  bookingId: string;
  amount: number;
  piId: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/dashboard` },
      redirect: "if_required",
    });
    if (error) {
      setError(error.message ?? "Payment failed.");
      setSubmitting(false);
      return;
    }
    // Inline success: reconcile (idempotent with the webhook), then hand back to
    // the parent to reset the form + refresh the balance. Without this a PARTIAL
    // payment leaves this form stuck on "Processing…" (the card stays mounted
    // because the balance isn't cleared).
    try {
      await reconcilePayment(bookingId, piId);
    } catch {
      // Payment already succeeded at Stripe; the webhook will finalise it.
    }
    onSuccess();
  }

  return (
    <form onSubmit={onSubmit} className="mt-3">
      <PaymentElement />
      {error && <p className="mt-2 text-[13px] text-err">{error}</p>}
      <Button type="submit" className="mt-3 w-full" disabled={!stripe || submitting}>
        {submitting ? "Processing…" : <>Pay <Money pence={amount} /></>}
      </Button>
    </form>
  );
}

export function MakePayment({ bookingId, balance }: { bookingId: string; balance: number }) {
  const router = useRouter();
  const [pounds, setPounds] = useState(() => (Math.min(20000, balance) / 100).toFixed(2));
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Quick-amount chips: only offer preset amounts strictly BELOW the balance, then
  // always the "Pay balance" chip — so there's never a duplicate at £100/£200.
  const chips = [
    ...[10000, 20000]
      .filter((p) => p < balance)
      .map((p) => ({ label: formatPence(p, { stripZeros: true }), pence: p })),
    { label: `Pay balance ${formatPence(balance, { stripZeros: true })}`, pence: balance },
  ];

  async function begin() {
    setError(null);
    const pence = Math.round(parseFloat(pounds || "0") * 100);
    if (!pence || pence < 100) {
      setError("Enter an amount of at least £1.");
      return;
    }
    setLoading(true);
    const r = await createBalancePaymentIntent(bookingId, pence);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setAmount(r.amount);
    setClientSecret(r.clientSecret);
  }

  if (clientSecret) {
    return (
      <div>
        <div className="text-[13px] text-soft">
          Paying <Money pence={amount} /> towards your balance.
        </div>
        <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret }}>
          <BalanceCheckout
            bookingId={bookingId}
            amount={amount}
            piId={clientSecret.split("_secret")[0]}
            onSuccess={() => {
              // Return to the amount chooser and pull the refreshed (lower/
              // cleared) balance so the card never gets stuck post-payment.
              setClientSecret(null);
              setPounds((Math.min(20000, balance) / 100).toFixed(2));
              router.refresh();
            }}
          />
        </Elements>
        <button
          type="button"
          onClick={() => setClientSecret(null)}
          className="mt-2 text-[12px] text-soft underline"
        >
          Change amount
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13px] text-soft">Pay any amount towards your balance whenever suits you.</p>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[15px] font-semibold">£</span>
        <Input
          type="number"
          min="1"
          step="0.01"
          value={pounds}
          onChange={(e) => setPounds(e.target.value)}
          className="flex-1"
          aria-label="Amount to pay"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {chips.map((c) => (
          <Button
            key={c.label}
            size="sm"
            variant="out"
            onClick={() => setPounds((c.pence / 100).toFixed(2))}
          >
            {c.label}
          </Button>
        ))}
      </div>
      {error && <p className="mt-2 text-[13px] text-err">{error}</p>}
      <Button className="mt-3 w-full" onClick={begin} disabled={loading}>
        {loading ? "Setting up…" : "Continue to pay →"}
      </Button>
    </div>
  );
}
