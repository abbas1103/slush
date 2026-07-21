"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";

/**
 * Google OAuth. Redirects to Google and back to /auth/callback. Works once the
 * Google provider is configured in the Supabase dashboard; until then the
 * provider returns an error we surface.
 */
export function SocialButtons({ next }: { next: string }) {
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);

  async function signInGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {error && (
        <div className="rounded-btn bg-errbg px-3 py-2 text-[13px] text-err">{error}</div>
      )}
      <Button type="button" variant="out" className="w-full" onClick={signInGoogle}>
        Continue with Google
      </Button>
    </div>
  );
}
