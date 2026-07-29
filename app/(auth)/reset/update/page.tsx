import { ResetUpdateForm } from "@/components/auth/ResetForms";

// Per-request render so the CSP nonce reaches this page's scripts; see the
// INVARIANT note in proxy.ts (audit #25). Without it the form never hydrates and
// a user who clicked a recovery link cannot set a new password.
export const dynamic = "force-dynamic";

export default function ResetUpdatePage() {
  return <ResetUpdateForm />;
}
