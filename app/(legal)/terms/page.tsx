import type { Metadata } from "next";
import { Section, P, Ul, Ph, DraftNotice } from "@/components/legal/prose";
import { TERMS_VERSION } from "@/lib/legal/version";

export const metadata: Metadata = {
  title: "Terms & Conditions - SLUSH",
  description: "The terms and booking conditions for SLUSH student ski trips.",
};

// Per-request render so the CSP nonce reaches this page's scripts; see the
// INVARIANT note in proxy.ts (audit #25).
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-[760px] px-6 py-12">
      <DraftNotice />

      <h1>Terms &amp; Conditions</h1>
      <p className="mt-2 text-[13px] text-soft">
        Version {TERMS_VERSION} · last updated 29 July 2026
      </p>

      <Section title="1. About these terms">
        <P>
          These terms govern your booking with SLUSH (“we”, “us”) for a student
          ski trip run in partnership with a university snowsports society (the
          “organiser”). By making a booking you accept these terms on behalf of
          everyone in your booking.{" "}
          <Ph>[Operator legal status and details to be confirmed.]</Ph>
        </P>
      </Section>

      <Section title="2. Your trip is a package">
        <P>
          A SLUSH trip combines travel, accommodation and other services and is
          a <strong>package</strong> under the Package Travel and Linked Travel
          Arrangements Regulations 2018. This means you benefit from statutory
          protections, including financial protection against our insolvency.
        </P>
        <P>
          <Ph>
            [Insolvency/financial protection to be confirmed - e.g. ABTA / ATOL /
            trust account / bonding - and the protection statement inserted here
            before launch.]
          </Ph>
        </P>
      </Section>

      <Section title="3. Booking & payment" id="booking">
        <Ul
          items={[
            "A deposit secures your place. Part of it is a downpayment towards your trip cost, and the rest is a refundable damage deposit held separately. The amounts for your trip are shown on the trip page and again at checkout, before you pay anything.",
            "You can instead pay in full at booking: your whole trip cost plus the refundable damage deposit.",
            "The remaining balance is due by the balance-due date shown on your booking. You can pay it off in instalments any time before then.",
            "All prices are in GBP. Your trip cost is the base price plus any extras you select (coach, equipment, lessons, events, winter-sports cover).",
            "Card payments are processed securely by Stripe; we never see or store your card details.",
          ]}
        />
      </Section>

      <Section title="4. The refundable damage deposit">
        <P>
          The damage deposit is taken with your first payment and refunded to the
          card you paid with after the trip, provided no charges apply. The
          amount held is shown at checkout and on your dashboard. We may withhold
          some or all of it for damage, losses or costs you are responsible for,
          and will tell you why.{" "}
          <Ph>
            [Grounds for withholding, and the deadline for returning the deposit,
            to be confirmed before launch.]
          </Ph>
        </P>
      </Section>

      <Section title="5. Capacity & the waiting list">
        <P>
          Places are limited. If the trip is full when your payment is taken,
          you’ll be placed on the waiting list and we’ll hold your payment. If a
          place opens up we’ll confirm you; if not, we refund everything you paid
          for that booking in full, including the downpayment.
        </P>
      </Section>

      <Section title="6. Cancellations & refunds" id="cancellations">
        <Ul
          items={[
            <span key="by-you">
              By you: there is no cancel button in your account. Email us as soon
              as you know and we’ll confirm in writing what happens to what
              you’ve paid. Cancellation charges may apply depending on how close
              to departure you cancel.{" "}
              <Ph>
                [Cancellation charge schedule to be set with legal advice and
                inserted here before launch.]
              </Ph>
            </span>,
            "There is no automatic free-cancellation window. If we offer one for a particular trip, we’ll say so in writing for that trip.",
            "By us: if we cancel your trip, you’re entitled to a full refund or an alternative where offered, in line with the Package Travel Regulations.",
            "Waiting-list bookings that aren’t confirmed are refunded in full.",
            "Refunds are made to the card you paid with.",
          ]}
        />
      </Section>

      <Section title="7. Insurance">
        <P>
          Suitable travel insurance with winter-sports cover is required. You
          can buy winter-sports cover as an extra during booking, or declare
          your own policy. It is your responsibility to ensure your cover is
          adequate for the activities you take part in.
        </P>
      </Section>

      <Section title="8. Passports, visas & travel documents">
        <P>
          You are responsible for holding a valid passport and any required
          visas or documents for the destination, and for meeting entry and
          health requirements. We are not liable for costs arising from missing
          or invalid documents.
        </P>
      </Section>

      <Section title="9. Behaviour & safety">
        <P>
          You must follow the reasonable instructions of trip staff, resort
          rules and local laws, and behave considerately towards others. We may
          end your trip without refund for behaviour that endangers others or
          seriously disrupts the trip.
        </P>
      </Section>

      <Section title="10. Changes to your trip">
        <P>
          Occasionally we may need to change trip details. We’ll tell you as soon
          as we can, and your rights for significant changes follow the Package
          Travel Regulations. <Ph>[Insert change/variation terms.]</Ph>
        </P>
      </Section>

      <Section title="11. Our liability">
        <P>
          We accept liability as required by the Package Travel Regulations and
          consumer law. Nothing in these terms limits liability that cannot be
          limited by law (including for death or personal injury caused by our
          negligence). <Ph>[Insert liability limits and exclusions, reviewed by counsel.]</Ph>
        </P>
      </Section>

      <Section title="12. Complaints">
        <P>
          If something goes wrong, tell trip staff at the time so we can help.
          Afterwards, contact your trip organiser, or us at{" "}
          <Ph>[Support email address to be confirmed before launch.]</Ph>
        </P>
      </Section>

      <Section title="13. Governing law">
        <P>
          These terms are governed by the laws of England &amp; Wales, and
          disputes are subject to the courts of England &amp; Wales.
        </P>
      </Section>
    </article>
  );
}
