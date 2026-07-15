"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * While a just-paid booking is still 'pending', the webhook hasn't finalised it
 * yet. Refresh the server component a few times until the status flips.
 */
export function StatusPoller({ maxTries = 15 }: { maxTries?: number }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries >= maxTries) return;
    const t = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, 2000);
    return () => clearTimeout(t);
  }, [tries, maxTries, router]);

  return null;
}
