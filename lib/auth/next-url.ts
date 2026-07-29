/** The origin `next` values are resolved against; `.invalid` can never exist. */
const SAME_SITE_BASE = "https://slush.invalid";

/** Tab/LF/CR: the URL parser strips these from anywhere in a URL before parsing. */
const URL_STRIPPED = /[\t\n\r]/g;

/**
 * True when a value is an absolute same-site path: exactly one leading "/", with
 * no protocol-relative or backslash escape after it (`//host` and `/\host` both
 * resolve to a different origin).
 */
function isSameSitePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

/**
 * Sanitise a post-auth redirect target to a same-site absolute path.
 * Prevents open-redirect via the `next` param (e.g. `//evil.com`, `https://…`).
 *
 * The value is parsed, not prefix-matched (audit #63). The URL parser strips
 * ASCII tab/LF/CR from anywhere in a URL before parsing, so a value like
 * "/<LF>/evil.com" gets past a naive `startsWith("/")` test while the browser
 * resolves it as the protocol-relative `//evil.com` - and `router.push()` then
 * leaves the site entirely. So we strip the same characters up front, resolve
 * against a placeholder origin, and accept the result only if it stayed on that
 * origin AND is still a same-site path (normalisation on its own can produce
 * `//host`, e.g. from `/..//evil.com`). Anything else falls back.
 */
export function sanitizeNext(
  next: string | string[] | null | undefined,
  fallback = "/",
): string {
  const raw = Array.isArray(next) ? next[0] : next;
  if (!raw) return fallback;
  // Decide on what the browser will actually see, not on the raw string.
  const value = raw.replace(URL_STRIPPED, "");
  if (!isSameSitePath(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, SAME_SITE_BASE);
  } catch {
    return fallback; // not resolvable as a URL at all
  }
  if (url.origin !== SAME_SITE_BASE) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;
  return isSameSitePath(path) ? path : fallback;
}
