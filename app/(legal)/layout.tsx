import Link from "next/link";
import { Footer } from "@/components/chrome/Footer";

/** Public chrome for the legal pages (privacy / terms) — no auth required. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-6">
          <Link href="/" className="text-[18px] font-extrabold tracking-tight text-ink">
            SLUSH
          </Link>
          <Link href="/" className="text-[13px] text-soft hover:text-ink">
            ← Back to site
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
