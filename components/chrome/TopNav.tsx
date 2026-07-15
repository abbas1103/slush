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
          <span className="hidden text-[13px] text-soft sm:inline">Need help?</span>
          <span className="grid size-8 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">
            {initials}
          </span>
        </div>
      </div>
    </header>
  );
}
