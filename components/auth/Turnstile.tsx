"use client";

import * as React from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** Turnstile is active only once a real site key is configured. */
export const turnstileEnabled =
  !!SITE_KEY && !SITE_KEY.startsWith("placeholder");

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string | undefined;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

/**
 * A Turnstile token is single-use, so a form that failed to submit has to reset
 * the widget before the student can try again - otherwise the next attempt
 * replays a redeemed token and Supabase rejects it as a captcha failure.
 */
export interface TurnstileHandle {
  reset: () => void;
}

const SCRIPT_ID = "cf-turnstile-script";

/** One shared promise for the api.js load, reused across mounts. */
let scriptPromise: Promise<void> | null = null;

/**
 * Resolves once window.turnstile exists. Mounting while the script tag is still
 * downloading has to wait for it: rendering straight away no-ops against an
 * undefined window.turnstile and leaves an empty box that blocks the form.
 */
function loadTurnstile(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  const promise = new Promise<void>((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const existing = document.getElementById(SCRIPT_ID);
    const script =
      existing instanceof HTMLScriptElement ? existing : document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  // A failed load must not poison later mounts.
  promise.catch(() => {
    if (scriptPromise === promise) scriptPromise = null;
  });
  scriptPromise = promise;
  return promise;
}

/**
 * Cloudflare Turnstile widget. Renders nothing (and requires no token) until a
 * real NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so local dev works without it.
 * `onToken` is called with undefined whenever the token stops being usable.
 */
export const Turnstile = React.forwardRef<
  TurnstileHandle,
  { onToken: (token?: string) => void }
>(({ onToken }, ref) => {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | undefined>(undefined);
  // Held in a ref so a new onToken identity never re-renders the widget.
  const onTokenRef = React.useRef(onToken);
  React.useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  React.useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        const id = widgetIdRef.current;
        if (id && window.turnstile) window.turnstile.reset(id);
        onTokenRef.current(undefined);
      },
    }),
    [],
  );

  React.useEffect(() => {
    if (!turnstileEnabled || !SITE_KEY) return;
    let cancelled = false;

    void loadTurnstile()
      .then(() => {
        if (cancelled || !boxRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(boxRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(undefined),
          "error-callback": () => onTokenRef.current(undefined),
        });
      })
      .catch(() => {
        // Script blocked or offline: the box stays empty and the form's own
        // guard tells the student the CAPTCHA is not complete.
      });

    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      widgetIdRef.current = undefined;
      // Drop the widget so a remount renders one rather than stacking a second.
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, []);

  if (!turnstileEnabled) return null;
  return <div ref={boxRef} className="mt-1" />;
});
Turnstile.displayName = "Turnstile";
