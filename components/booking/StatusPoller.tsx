"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/**
 * While a just-paid booking is still 'pending', the webhook hasn't finalised it
 * yet. Refresh the server component until the status flips, on a widening
 * backoff - and when the tries run out, say so, rather than leaving the page
 * promising an update that will never come (audit #82/#91).
 */
export function StatusPoller({ maxTries = 8 }: { maxTries?: number }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  const [refreshing, startRefresh] = useTransition();
  const exhausted = tries >= maxTries;

  useEffect(() => {
    // Only ever one refresh in the air: the next one is scheduled after the
    // previous has landed, so requests can't stack up. 2s, 4s, 8s, then 10s.
    if (exhausted || refreshing) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      startRefresh(() => {
        router.refresh();
      });
    }, Math.min(2000 * 2 ** tries, 10000));
    return () => clearTimeout(t);
  }, [tries, exhausted, refreshing, router]);

  if (exhausted) {
    return (
      <Card className="mb-6">
        <div className="text-[14px] font-semibold text-ink">
          We haven&apos;t had confirmation from your bank yet
        </div>
        <p className="mt-1 text-[13px] text-soft">
          Your payment is safe - if it went through we have it, and your booking updates the moment
          it lands. Check again, or pick this up from your dashboard.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={refreshing}
            onClick={() => {
              startRefresh(() => {
                router.refresh();
              });
            }}
          >
            {refreshing ? "Checking…" : "Check again"}
          </Button>
          <Link href="/dashboard" className={buttonVariants({ variant: "out", size: "sm" })}>
            Go to my dashboard
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <p className="mb-4 text-center text-[12.5px] text-soft" aria-live="polite">
      <span aria-hidden className="animate-pulse">●</span> Checking for confirmation…
    </p>
  );
}
