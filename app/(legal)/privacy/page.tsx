import type { Metadata } from "next";
import { Section, P, Ul, Ph, DraftNotice } from "@/components/legal/prose";

export const metadata: Metadata = {
  title: "Privacy Policy - SLUSH",
  description: "How SLUSH collects, uses and protects your personal data.",
};

// Per-request render so the CSP nonce reaches this page's scripts; see the
// INVARIANT note in proxy.ts (audit #25). Prerendering this page would block its
// bootstrap scripts, breaking client-side navigation away from it.
export const dynamic = "force-dynamic";

/**
 * Version identifier for this document, shown at the top of the page - bump it,
 * and the date below, whenever the wording changes. Every claim here is meant to
 * match what the code actually does; if you change what is collected, shared or
 * kept, change this page in the same commit.
 */
const PRIVACY_VERSION = "privacy-2026-07-29-draft";

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-[760px] px-6 py-12">
      <DraftNotice />

      <h1>Privacy Policy</h1>
      <p className="mt-2 text-[13px] text-soft">
        Version {PRIVACY_VERSION} · last updated 29 July 2026
      </p>

      <Section title="1. Who we are">
        <P>
          SLUSH (“we”, “us”) provides a booking platform for student ski trips
          run in partnership with university snowsports societies. For the
          personal data described here, SLUSH is the data controller.{" "}
          <Ph>[Operator legal status, address and any ICO registration to be confirmed.]</Ph>
        </P>
        <P>
          Questions about this policy or your data:{" "}
          <Ph>[Data-protection contact address to be confirmed before launch.]</Ph>{" "}
          Until that address is published, ask your trip organiser (your
          university snowsports society) and they will pass your request to us.
        </P>
      </Section>

      <Section title="2. The data we collect">
        <Ul
          items={[
            "Account: email address and authentication details.",
            "Booking & traveller details: name, title, date of birth, nationality, passport number, phone number, university/society and student ID.",
            "Emergency contact: name, relationship and phone number.",
            "Health & accessibility: medical or access needs you choose to tell us (special-category data - collected only with your explicit consent).",
            "Insurance: your policy details, or the winter-sports cover you buy through us.",
            "Payments: handled by Stripe. We never see or store your full card number - only Stripe payment/charge identifiers and the amounts and status of payments.",
            "Technical: essential cookies for sign-in, a CAPTCHA on sign-in and sign-up, and security records (IP address, timestamps) used to rate-limit abuse and keep the platform reliable.",
          ]}
        />
      </Section>

      <Section title="3. Why we use it, and our lawful basis">
        <Ul
          items={[
            "To take and manage your booking and payments - performance of our contract with you.",
            "Access or medical needs, and sharing them with the resort/organiser - your explicit consent.",
            "Keeping financial records (e.g. for tax and accounting) - legal obligation.",
            "Securing the platform and preventing fraud - our legitimate interests.",
            "Marketing emails - only where you have opted in (consent); tell us and we will stop at any time.",
          ]}
        />
      </Section>

      <Section title="4. Sensitive information">
        <P>
          Sensitive fields - including your passport number, phone number, your
          emergency contact’s details, your insurer policy number and any access
          or medical needs - are <strong>encrypted at rest</strong>, with the key
          held outside the database. We ask for health and access information
          only to run the trip safely, only with your explicit consent, and we
          share it with the resort or organiser only where you have agreed.
        </P>
      </Section>

      <Section title="5. Who we share it with">
        <Ul
          items={[
            "Stripe - payment processing.",
            "Supabase - our database and authentication provider (hosted in the EU).",
            "Vercel - our hosting provider, which handles the requests you make to the site.",
            "Your trip organiser - the society running your trip. Their administrators see your booking in the SLUSH admin area: your name, email, booking status, and the amounts paid and outstanding.",
            <span key="resort">
              The resort and trip suppliers - the traveller details they need to
              run your trip, and only where they ask for them. Access or medical
              needs are included only if you asked us to share them.{" "}
              <Ph>
                [The pre-departure manifest is produced by hand today: what is
                sent, to whom, and how, to be confirmed before launch.]
              </Ph>
            </span>,
            "A customer-records (CRM) system, where we have one connected - your name, email, phone number, university/society and a summary of your booking and payments. Your passport number, date of birth and health information are never sent to it.",
            "Error monitoring (Sentry), where enabled - technical diagnostics, with request bodies, cookies and headers stripped before anything leaves our servers.",
            "Cloudflare and Upstash, where enabled - the CAPTCHA and the rate-limiting that protect sign-in and payment; they see your IP address or user id, not your booking details.",
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
            "Booking and traveller details (including passport number, date of birth and emergency contact): kept while we need them to run your trip and to deal with anything arising from it, such as an insurance claim or a complaint.",
            <span key="schedule">
              Automatic deletion is not switched on yet, and the retention
              periods are still being set.{" "}
              <Ph>
                [Retention schedule to be confirmed, and the deletion job built,
                before launch.]
              </Ph>{" "}
              In the meantime, ask us and we will delete what we are not required
              to keep.
            </span>,
            "Financial records: kept for as long as tax and accounting law requires (roughly 6-7 years), and kept to the minimum needed.",
            "Account data: kept while your account is active, then deleted on request apart from the financial records above.",
          ]}
        />
      </Section>

      <Section title="8. Your rights">
        <P>
          You have the right to access, correct, delete or receive a copy of
          your data, to object to or restrict processing, and to withdraw
          consent at any time. There are no self-service buttons for this yet, so
          we handle requests by hand: contact{" "}
          <Ph>[Data-protection contact address to be confirmed before launch.]</Ph>{" "}
          or ask your trip organiser to pass the request on, and we will respond
          within the time limit the law allows. You can also complain to the UK
          Information Commissioner’s Office (ico.org.uk).
        </P>
      </Section>

      <Section title="9. Cookies">
        <P>
          We use only essential cookies - to keep you signed in and to protect
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
          We may update this policy; the version identifier and “last updated”
          date at the top change when we do. Questions:{" "}
          <Ph>[Data-protection contact address to be confirmed before launch.]</Ph>
        </P>
      </Section>
    </article>
  );
}
