import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { NavPills } from "./NavPills";

/** Top navigation bar for authenticated screens: wordmark + help + avatar. */
export function TopNav({ user, pills = false }: { user: User | null; pills?: boolean }) {
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-6">
        <Link href="/" className="text-[18px] font-extrabold tracking-tight text-ink">
          SLUSH
        </Link>
        {pills && <NavPills />}
        <div className="flex items-center gap-3">
          <Link href="/help" className="hidden text-[13px] text-soft hover:text-ink sm:inline">
            Need help?
          </Link>
          <details className="relative">
            <summary className="grid size-8 cursor-pointer list-none place-items-center rounded-full bg-ink text-[12px] font-semibold text-white [&::-webkit-details-marker]:hidden">
              {initials}
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-lg">
              {user?.email && (
                <div className="truncate px-3.5 py-2 text-[12px] text-soft">{user.email}</div>
              )}
              <Link
                href="/account"
                className="block px-3.5 py-2 text-[13px] text-ink hover:bg-soft-panel"
              >
                Account
              </Link>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="block w-full px-3.5 py-2 text-left text-[13px] text-ink hover:bg-soft-panel"
                >
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
