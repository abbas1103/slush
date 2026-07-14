/**
 * Sanitise a post-auth redirect target to a same-site absolute path.
 * Prevents open-redirect via the `next` param (e.g. `//evil.com`, `https://…`).
 */
export function sanitizeNext(
  next: string | string[] | null | undefined,
  fallback = "/",
): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback; // must be a path
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback; // not protocol-relative
  return value;
}
