/**
 * Human copy for Supabase Auth failures.
 *
 * The auth forms used to render `error.message` straight from the API, so a
 * student could be shown raw provider strings: "email rate limit exceeded",
 * 'Email address "x@example.com" is invalid', "Invalid login credentials". None
 * of those say what to do next, and the first two read like a bug in the form.
 *
 * Anything unrecognised falls back to a generic line rather than leaking the
 * provider's wording - the original message still reaches Sentry via the caller.
 */

interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

const COPY: Record<string, string> = {
  // Supabase returns this for a wrong password AND for a correct password on an
  // unconfirmed account - the two are not distinguishable from the client - so
  // the copy has to cover both without implying which it was.
  invalid_credentials:
    "That email or password isn't right. Check them and try again - or if you've just signed up, confirm your email address first.",
  email_not_confirmed:
    "Please confirm your email address first - check your inbox for the link we sent you.",
  email_address_invalid: "We can't use that email address. Please try a different one.",
  user_already_exists: "There's already an account with that email address. Try logging in instead.",
  weak_password: "Please choose a longer password - at least 10 characters.",
  same_password: "That's already your password. Please choose a different one.",
  // Both of these are the built-in email service's quota, not anything the
  // student did. Don't show them a number of seconds they can't act on.
  over_email_send_rate_limit:
    "We can't send emails just now, so we couldn't finish that. Please try again in a few minutes.",
  over_request_rate_limit: "Too many attempts just now. Please wait a moment and try again.",
  captcha_failed: "The CAPTCHA didn't verify. Please try again.",
  otp_expired: "That link has expired. Please request a new one.",
  session_expired: "You've been signed out. Please log in again.",
};

const FALLBACK = "Something went wrong. Please try again.";

/** Map a Supabase auth error to copy safe to show a student. */
export function authErrorCopy(error: AuthErrorLike | null | undefined): string {
  if (!error) return FALLBACK;
  if (error.code && COPY[error.code]) return COPY[error.code];
  // Older SDK paths and a few endpoints report only a status.
  if (error.status === 429) return COPY.over_request_rate_limit;
  return FALLBACK;
}
