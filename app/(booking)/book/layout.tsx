import { requireVerified } from "@/lib/auth/guards";

/** The booking flow (after the hold) requires a verified email — it collects
 *  PII and takes payment. Browsing the trip only needs a logged-in user. */
export default async function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireVerified("/trip");
  return <>{children}</>;
}
