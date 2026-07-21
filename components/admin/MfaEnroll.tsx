"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

/**
 * TOTP enrolment for admins. Fetches a QR + secret from Supabase, then verifies
 * the first 6-digit code - a successful verify elevates THIS session to aal2
 * (the browser client writes the new session to cookies, which the server then
 * reads). Any half-finished (unverified) TOTP factor is unenrolled first so a
 * retry can't wedge on a duplicate.
 */
export function MfaEnroll() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "verifying">("loading");

  // The async work; awaits first, so no setState runs synchronously when this
  // is invoked from the mount effect (keeps the effect body side-effect-clean).
  const enroll = useCallback(async () => {
    // Clear stale unverified factors from an abandoned attempt.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.factor_type === "totp" && f.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "SLUSH admin",
    });
    if (error || !data) {
      // e.g. TOTP disabled in the Supabase project - surface it plainly.
      setError(error?.message ?? "Could not start enrolment.");
      setPhase("ready");
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setPhase("ready");
  }, [supabase]);

  useEffect(() => {
    enroll();
  }, [enroll]);

  // "Start over" button: reset visible state, then re-run enrolment.
  function restart() {
    setError(null);
    setFactorId(null);
    setQr(null);
    setSecret(null);
    setPhase("loading");
    enroll();
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setPhase("verifying");
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr || !ch) {
      setError(chErr?.message ?? "Could not start the challenge. Try again.");
      setPhase("ready");
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.id,
      code: code.trim(),
    });
    if (vErr) {
      setError(vErr.message);
      setPhase("ready");
      return;
    }
    // Session is now aal2 - send them into the CMS.
    router.replace("/admin");
    router.refresh();
  }

  return (
    <form onSubmit={onVerify} className="flex flex-col gap-5">
      {error && (
        <div className="rounded-btn bg-errbg px-3 py-2 text-[13px] text-err">{error}</div>
      )}

      <ol className="flex flex-col gap-4 text-[14px] text-ink-2">
        <li>
          <span className="font-semibold text-ink">1. Scan this code</span> in an authenticator
          app (Google Authenticator, 1Password, Authy…).
          <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="flex size-[172px] items-center justify-center rounded-card border border-line bg-white p-3">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- data-URL SVG from Supabase, no remote fetch
                <img src={qr} alt="TOTP QR code" width={148} height={148} />
              ) : (
                <span className="text-[13px] text-soft">
                  {phase === "loading" ? "Generating…" : "-"}
                </span>
              )}
            </div>
            {secret && (
              <div className="text-[13px] text-soft">
                <div>Can’t scan? Enter this key manually:</div>
                <code className="mt-1 inline-block break-all rounded-btn bg-chip px-2 py-1 font-mono text-[12.5px] text-ink">
                  {secret}
                </code>
              </div>
            )}
          </div>
        </li>
        <li>
          <span className="font-semibold text-ink">2. Enter the 6-digit code</span> the app shows.
        </li>
      </ol>

      <Field label="Verification code">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          className="max-w-[180px] tracking-[0.3em]"
          required
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={phase !== "ready" || code.length !== 6}>
          {phase === "verifying" ? "Verifying…" : "Verify & enable"}
        </Button>
        {phase === "ready" && (
          <button
            type="button"
            onClick={restart}
            className="text-[13px] font-medium text-soft hover:text-ink"
          >
            Start over
          </button>
        )}
      </div>
    </form>
  );
}
