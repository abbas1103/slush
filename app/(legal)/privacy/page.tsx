import type { Metadata } from "next";
import { Section, P, Ul, Ph, DraftNotice } from "@/components/legal/prose";

export const metadata: Metadata = {
  title: "Privacy Policy — SLUSH",
  description: "How SLUSH collects, uses and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-[760px] px-6 py-12">
      <DraftNotice />

      <h1>Privacy Policy</h1>
      <p className="mt-2 text-[13px] text-soft">Last updated 22 July 2026</p>

      <Section title="1. Who we are">
        <P>
          SLUSH (“we”, “us”) provides a booking platform for student ski trips
          run in partnership with university snowsports societies. For the
          personal data described here, the data controller is{" "}
          <Ph>SLUSH Ltd</Ph>, registered in England &amp; Wales (company no.{" "}
          <Ph>00000000</Ph>), registered office <Ph>[address]</Ph>, ICO
          registration <Ph>[ZA000000]</Ph>.
        </P>
        <P>
          Questions about this policy or your data: <Ph>privacy@slush.example</Ph>.
        </P>
      </Section>

      <Section title="2. The data we collect">
        <Ul
          items={[
            "Account: email address and authentication details.",
            "Booking & traveller details: name, title, date of birth, nationality, passport number, phone number, home address, university/society and student ID.",
            "Emergency contact: name, relationship and phone number.",
            "Health & accessibility: medical, dietary or access needs you choose to tell us (special-category data — collected only with your explicit consent).",
            "Insurance: your policy details, or the winter-sports cover you buy through us.",
            "Payments: handled by Stripe. We never see or store your full card number — only Stripe payment/charge identifiers and the amounts and status of payments.",
            "Technical: essential cookies for sign-in, and server logs (IP, timestamps) for security and reliability.",
          ]}
        />
      </Section>

      <Section title="3. Why we use it, and our lawful basis">
        <Ul
          items={[
            "To take and manage your booking and payments — performance of our contract with you.",
            "Health, dietary, access needs and sharing them with the resort/organiser — your explicit consent.",
            "Keeping financial records (e.g. for tax and accounting) — legal obligation.",
            "Securing the platform and preventing fraud — our legitimate interests.",
            "Marketing emails — only where you have opted in (consent); you can withdraw at any time.",
          ]}
        />
      </Section>

      <Section title="4. Sensitive information">
        <P>
          Passport number, insurer policy number and any access/medical needs
          are <strong>encrypted at rest</strong>. We ask for health and access
          information only to run the trip safely, only with your explicit
          consent, and we share it with the resort or organiser only where you
          have agreed.
        </P>
      </Section>

      <Section title="5. Who we share it with">
        <Ul
          items={[
            "Stripe — payment processing.",
            "Supabase — our database and authentication provider (hosted in the EU).",
            "The trip organiser / resort — the traveller manifest needed to run your trip.",
            "Error-monitoring (Sentry) — technical diagnostics, with personal data scrubbed.",
            "We do not sell your personal data.",
          ]}
        />
      </Section>

      <Section title="6. International transfers">
        <P>
          Your data is stored in the EU. Some processors (e.g. Stripe, Sentry)
          may process data outside the UK/EU; where they do, transfers are
          covered by appropriate safeguards such as the UK IDTA / EU Standard
          Contractual Clauses or an adequacy/Data Privacy Framework
          certification. <Ph>[Confirm each processor’s mechanism.]</Ph>
        </P>
      </Section>

      <Section title="7. How long we keep it">
        <Ul
          items={[
            "Passport and manifest data: deleted or anonymised shortly after the trip ends (target: within [30–90] days).",
            "Financial records: retained for approximately 6–7 years as required by law, minimised where possible.",
            "Account data: kept while your account is active, then deleted on request.",
          ]}
        />
      </Section>

      <Section title="8. Your rights">
        <P>
          You have the right to access, correct, delete or receive a copy of
          your data, to object to or restrict processing, and to withdraw
          consent at any time. To exercise these, contact{" "}
          <Ph>privacy@slush.example</Ph>. You can also complain to the UK
          Information Commissioner’s Office (ico.org.uk).
        </P>
      </Section>

      <Section title="9. Cookies">
        <P>
          We use only essential cookies — to keep you signed in and to protect
          sign-in with a CAPTCHA. We do not use advertising or cross-site
          tracking cookies.
        </P>
      </Section>

      <Section title="10. Children">
        <P>
          SLUSH is intended for users aged 18 and over; we do not knowingly
          collect data from anyone under 18.
        </P>
      </Section>

      <Section title="11. Changes & contact">
        <P>
          We may update this policy; the “last updated” date shows the latest
          version. Questions: <Ph>privacy@slush.example</Ph>.
        </P>
      </Section>
    </article>
  );
}
