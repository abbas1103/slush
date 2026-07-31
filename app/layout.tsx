import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * No `weight` list, because Inter on Google Fonts is variable-ONLY: the five
 * weights this app uses (400 body, 500 medium, 600 semibold, 700 bold, 800
 * extrabold) all resolve to the same variable files, so naming them bought
 * nothing. It emitted 36 @font-face rules (5 weights x 7 unicode ranges) pointing
 * at 7 files; this emits 7, one per range, each declaring `font-weight: 100 900`.
 *
 * Byte-neutral on the wire, to be clear - about 7 KB less CSS to parse but a
 * fraction of a KB more gzipped, since the duplicated rules compressed well. It is
 * here because the config now says what actually happens. A browser rendering
 * English downloads ONE woff2 (the preloaded latin subset); the other six are
 * cyrillic/greek/vietnamese/latin-ext ranges that are never fetched.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SLUSH - Student Led Uni Ski Holidays",
  description:
    "Book your student ski trip: view your trip, build your booking, pay a deposit and unlock your lift pass - all in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
