import { ResetRequestForm } from "@/components/auth/ResetForms";

// Rendered per request so proxy.ts's per-request CSP nonce can reach the inline
// bootstrap scripts (see the INVARIANT note in proxy.ts). Prerendered HTML is
// built before any request exists, so its scripts carry no nonce, the browser
// blocks them, and this client-only form never hydrates - which killed password
// reset in production while working fine in dev (audit #25).
export const dynamic = "force-dynamic";

export default function ResetPage() {
  return <ResetRequestForm />;
}
