import type { Metadata } from "next";
import { Section, P, Ul, Ph, DraftNotice } from "@/components/legal/prose";

export const metadata: Metadata = {
  title: "Terms & Conditions - SLUSH",
  description: "The terms and booking conditions for SLUSH student ski trips.",
};

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-[760px] px-6 py-12">
      <DraftNotice />

      <h1>Terms &amp; Conditions</h1>
      <p className="mt-2 text-[13px] text-soft">Last updated 22 July 2026</p>

      <Section title="1. About these terms">
        <P>
          These terms govern your booking with SLUSH (“we”, “us”) for a student
          ski trip run in partnership with a university snowsports society (the
          “organiser”). By making a booking you accept these terms on behalf of
          everyone in your booking.{" "}
          <Ph>[Operator legal status and details to be confirmed.]</Ph>
        </P>
      </Section>

      <Section title="2. Your trip is a package" id="booking">
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

      <Section title="3. Booking & payment">
        <Ul
          items={[
            "A £150 deposit secures your place: £50 is a downpayment towards your trip cost, and £100 is a refundable damage deposit held separately.",
            "You can instead pay in full at booking (trip cost + the £100 refundable damage deposit).",
            "The remaining balance is due by the balance-due date shown on your booking. You can pay it off in instalments any time before then.",
            "All prices are in GBP. Your trip cost is the base price plus any extras you select (coach, equipment, lessons, events, winter-sports cover).",
            "Card payments are processed securely by Stripe; we never store your card details.",
          ]}
        />
      </Section>

      <Section title="4. The refundable damage deposit">
        <P>
          The £100 damage deposit is taken up front and refunded to your card
          after the trip, provided no charges apply. We may withhold some or all
          of it for damage, losses or costs you are responsible for, and will
          tell you why. <Ph>[Detail the damage-deposit terms and process.]</Ph>
        </P>
      </Section>

      <Section title="5. Capacity & the waiting list">
        <P>
          Places are limited. If the trip is full when your payment is taken,
          you’ll be placed on the waiting list and we’ll hold your payment. If a
          place opens up we’ll confirm you; if not, we refund your £150 deposit
          in full (including the £50 downpayment).
        </P>
      </Section>

      <Section title="6. Cancellations & refunds">
        <Ul
          items={[
            "By you: cancellation charges apply depending on how close to departure you cancel. [Insert the cancellation charge schedule.]",
            "By us: if we cancel your trip, you’re entitled to a full refund or an alternative where offered, in line with the Package Travel Regulations.",
            "Waiting-list bookings that aren’t confirmed are refunded in full.",
            "Refunds are made to your original payment method.",
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
          If something goes wrong, tell trip staff at the time so we can help,
          and contact us afterwards at <Ph>support@slush.example</Ph>.
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
