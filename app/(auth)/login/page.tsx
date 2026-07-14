import { LoginForm } from "@/components/auth/LoginForm";
import { sanitizeNext } from "@/lib/auth/next-url";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const sp = await searchParams;
  return <LoginForm next={sanitizeNext(sp.next)} />;
}
