import { LoginForm } from "@/components/auth/LoginForm";
import { sanitizeNext } from "@/lib/auth/next-url";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string; reset?: string }>;
}) {
  const sp = await searchParams;
  const initialError =
    sp.error === "auth_callback"
      ? "That sign-in link didn’t work or has expired — please try again."
      : undefined;
  return (
    <LoginForm next={sanitizeNext(sp.next)} initialError={initialError} resetDone={sp.reset === "1"} />
  );
}
