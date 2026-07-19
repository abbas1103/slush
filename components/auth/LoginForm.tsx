"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { SocialButtons } from "./SocialButtons";
import { Turnstile, turnstileEnabled } from "./Turnstile";

export function LoginForm({
  next,
  initialError,
  resetDone,
}: {
  next: string;
  initialError?: string;
  resetDone?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [captcha, setCaptcha] = useState<string>();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (turnstileEnabled && !captcha) {
      setError("Please complete the CAPTCHA.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captcha ? { captchaToken: captcha } : undefined,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[380px] flex-col gap-4">
      <div>
        <h1>Log in</h1>
        <p className="mt-1 text-[15px] text-soft">
          Welcome back. Enter your details to continue.
        </p>
      </div>

      {resetDone && !error && (
        <div className="rounded-btn bg-okbg px-3 py-2 text-[13px] text-ok">
          Your password has been updated — please log in.
        </div>
      )}

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

      <Field label="Password">
        <div className="relative">
          <Input
            type={showPwd ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="pr-14"
          />
          <button
            type="button"
            onClick={() => setShowPwd((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-soft"
          >
            {showPwd ? "hide" : "show"}
          </button>
        </div>
      </Field>

      <div className="flex items-center justify-between">
        <Checkbox defaultChecked>
          <span className="text-[13px]">Remember me</span>
        </Checkbox>
        <Link href="/reset" className="text-[13px] font-medium text-ink underline">
          Forgot password?
        </Link>
      </div>

      <Turnstile onToken={setCaptcha} />

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Logging in…" : "Log in"}
      </Button>

      <div className="flex items-center gap-3 text-[12px] text-soft">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <SocialButtons next={next} />

      <p className="text-center text-[13px] text-soft">
        No account?{" "}
        <Link
          href={`/signup?next=${encodeURIComponent(next)}`}
          className="font-medium text-ink underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
