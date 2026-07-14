import { SignupForm } from "@/components/auth/SignupForm";
import { sanitizeNext } from "@/lib/auth/next-url";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const sp = await searchParams;
  return <SignupForm next={sanitizeNext(sp.next)} />;
}
