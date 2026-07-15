"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

/**
 * Per-sign-in TOTP challenge. An admin with a verified factor lands here at
 * aal1; entering a valid code elevates the session to aal2 for the rest of the
 * sign-in. `next` is a pre-sanitised relative path to continue to.
 */
export function MfaChallenge({ next }: { next: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "verifying">("loading");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      const totp = data?.totp?.find((f) => f.status === "verified") ?? null;
      if (error || !totp) {
        // No verified factor after all → send them to enrol.
        router.replace("/admin/security");
        return;
      }
      setFactorId(totp.id);
      setPhase("ready");
    })();
  }, [supabase, router]);

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
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onVerify} className="flex flex-col gap-5">
      {error && (
        <div className="rounded-btn bg-errbg px-3 py-2 text-[13px] text-err">{error}</div>
      )}
      <p className="text-[14px] text-ink-2">
        Enter the 6-digit code from your authenticator app to continue.
      </p>
      <Field label="Verification code">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          className="max-w-[180px] tracking-[0.3em]"
          autoFocus
          required
        />
      </Field>
      <Button type="submit" disabled={phase !== "ready" || code.length !== 6}>
        {phase === "verifying" ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}
