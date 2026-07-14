"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

export function ResetRequestForm() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Generic response regardless of whether the account exists (no enumeration).
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset/update`,
    });
    setLoading(false);
    setSent(true);
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[380px] flex-col gap-4">
      <div>
        <h1>Reset password</h1>
        <p className="mt-1 text-[15px] text-soft">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>
      {sent ? (
        <div className="rounded-btn bg-okbg px-3 py-2 text-[13px] text-ok">
          If an account exists for that email, we&apos;ve sent a reset link.
        </div>
      ) : (
        <>
          <Field label="Email address">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Sending…" : "Send reset link"}
          </Button>
        </>
      )}
    </form>
  );
}

export function ResetUpdateForm() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/login?reset=1");
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[380px] flex-col gap-4">
      <div>
        <h1>Set a new password</h1>
        <p className="mt-1 text-[15px] text-soft">Choose a new password for your account.</p>
      </div>
      {error && (
        <div className="rounded-btn bg-errbg px-3 py-2 text-[13px] text-err">{error}</div>
      )}
      <Field label="New password" hint="At least 10 characters.">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={10}
          autoComplete="new-password"
        />
      </Field>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
