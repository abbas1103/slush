"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveTripCode, type ResolveResult } from "@/app/(booking)/trip/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { Money } from "@/components/ui/Money";
import { Card } from "@/components/ui/Card";

type Found = Extract<ResolveResult, { ok: true }>;

export function TripCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await resolveTripCode(code);
      if (!r.ok) {
        setError("We couldn't find a trip for that code. Check it and try again.");
        return;
      }
      setResult(r);
    });
  }

  return (
    <div className="mx-auto w-full max-w-[640px] text-center">
      <span className="inline-flex items-center rounded-full bg-chip px-3 py-1 text-[12px] font-semibold text-ink-2">
        ↗ Step 1 of 2
      </span>
      <h1 className="mt-4">Enter your trip code</h1>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-soft">
        Your trip organiser will have sent you a unique code. Drop it in below to
        view your trip and book your place.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter your trip code"
          className="flex-1"
          autoFocus
          aria-label="Trip code"
        />
        <Button type="submit" disabled={pending || !code.trim()}>
          {pending ? "Finding…" : "Find my trip"}
        </Button>
      </form>

      {error && <p className="mt-4 text-[13px] text-err">{error}</p>}

      {result && (
        <Card padding="none" className="mt-6 overflow-hidden text-left">
          <div className="bg-panel px-5 py-3 text-[13px] font-semibold text-white">
            ✓ Code valid - we found your trip
          </div>
          <div className="flex items-center justify-between gap-4 p-5">
            <div>
              <div className="text-[16px] font-bold">{result.name}</div>
              <div className="text-[13px] text-soft">{result.organiser}</div>
              <div className="mt-1 text-[13px] text-soft">{result.resort}</div>
              <div className="mt-2">
                <Pill variant="success" dot>
                  Booking live
                </Pill>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] text-soft">from</div>
              <div className="text-[22px] font-extrabold">
                <Money pence={result.basePrice} stripZeros />
              </div>
              <Button
                size="sm"
                className="mt-2"
                onClick={() => router.push(`/trip/${encodeURIComponent(result.code)}`)}
              >
                View trip →
              </Button>
            </div>
          </div>
        </Card>
      )}

      <p className="mt-5 text-[13px] text-soft">
        Can&apos;t find your code? Contact your trip organiser.
      </p>
    </div>
  );
}
