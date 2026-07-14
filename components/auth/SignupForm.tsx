"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SocialButtons } from "./SocialButtons";
import { Turnstile, turnstileEnabled } from "./Turnstile";

export function SignupForm({ next }: { next: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    if (turnstileEnabled && !captcha) {
      setError("Please complete the CAPTCHA.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken: captcha,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Email confirmation on → no active session yet; otherwise straight in.
    if (data.session) {
      router.push(next);
      router.refresh();
    } else {
      router.push("/verify-email");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[380px] flex-col gap-4">
      <div>
        <h1>Create your account</h1>
        <p className="mt-1 text-[15px] text-soft">
          Sign up to book your trip and manage your booking.
        </p>
      </div>

      {error && (
        <div className="rounded-btn bg-errbg px-3 py-2 text-[13px] text-err">{error}</div>
      )}

      <Field label="Email address">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </Field>

      <Field label="Password" hint="At least 10 characters.">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          minLength={10}
        />
      </Field>

      <Turnstile onToken={setCaptcha} />

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating account…" : "Create account"}
      </Button>

      <div className="flex items-center gap-3 text-[12px] text-soft">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <SocialButtons next={next} />

      <p className="text-center text-[13px] text-soft">
        Already have an account?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="font-medium text-ink underline"
        >
          Log in
        </Link>
      </p>
    </form>
  );
}
