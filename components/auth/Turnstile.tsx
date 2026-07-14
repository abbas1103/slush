"use client";

import { useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** Turnstile is active only once a real site key is configured. */
export const turnstileEnabled =
  !!SITE_KEY && !SITE_KEY.startsWith("placeholder");

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void },
      ) => void;
    };
  }
}

/**
 * Cloudflare Turnstile widget. Renders nothing (and requires no token) until a
 * real NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so local dev works without it.
 */
export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!turnstileEnabled || !SITE_KEY) return;
    const scriptId = "cf-turnstile-script";

    const render = () => {
      if (ref.current && window.turnstile) {
        window.turnstile.render(ref.current, { sitekey: SITE_KEY, callback: onToken });
      }
    };

    const existing = document.getElementById(scriptId);
    if (existing) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [onToken]);

  if (!turnstileEnabled) return null;
  return <div ref={ref} className="mt-1" />;
}
