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

function BalanceCheckout({ bookingId, amount, piId }: { bookingId: string; amount: number; piId: string }) {
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
      confirmParams: { return_url: `${window.location.origin}/dashboard` },
      redirect: "if_required",
    });
    if (error) {
      setError(error.message ?? "Payment failed.");
      setSubmitting(false);
      return;
    }
    // Inline success: reconcile immediately. Redirect methods return to
    // /dashboard where PaymentReturn reconciles.
    await reconcilePayment(bookingId, piId);
    router.refresh();
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
  const [pounds, setPounds] = useState(() => (Math.min(20000, balance) / 100).toFixed(2));
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chips = [
    { label: "£100", pence: 10000 },
    { label: "£200", pence: 20000 },
    { label: `Pay balance ${formatPence(balance, { stripZeros: true })}`, pence: balance },
  ].filter((c) => c.pence <= balance || c.pence === balance);

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
          <BalanceCheckout bookingId={bookingId} amount={amount} piId={clientSecret.split("_secret")[0]} />
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
