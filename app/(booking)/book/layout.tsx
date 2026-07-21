import { headers } from "next/headers";
import { requireVerified } from "@/lib/auth/guards";

/** The booking flow (after the hold) requires a verified email - it collects
 *  PII and takes payment. Browsing the trip only needs a logged-in user. */
export default async function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = (await headers()).get("x-pathname") ?? "/trip";
  await requireVerified(path);
  return <>{children}</>;
}
