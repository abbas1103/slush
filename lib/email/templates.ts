import { formatPence } from "@/lib/utils/money";
import type { EmailPayload, EmailTemplate, RenderedEmail } from "./types";

/**
 * Plain, legible messages. Deliberately simple HTML with inline styles and no
 * images: it renders the same in Gmail, Outlook and Apple Mail, survives dark
 * mode, and keeps the text part meaningful for anyone reading plain text.
 *
 * Money is formatted from integer pence at render time - never stored formatted,
 * so a currency or rounding change cannot rewrite what a student was told.
 */

const SIGN_OFF = "The SLUSH team";

function shell(heading: string, bodyLines: string[], cta?: { label: string; url: string }): RenderedEmail["html"] {
  const paras = bodyLines
    .map((l) => `<p style="margin:0 0 14px;line-height:1.55">${l}</p>`)
    .join("");
  const button = cta
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${cta.label}</a></p>`
    : "";
  return [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#111;max-width:520px;margin:0 auto;padding:24px">`,
    `<div style="font-weight:800;font-size:20px;letter-spacing:-0.02em;margin-bottom:20px">SLUSH</div>`,
    `<h1 style="font-size:22px;font-weight:800;margin:0 0 16px;line-height:1.25">${heading}</h1>`,
    paras,
    button,
    `<p style="margin:28px 0 0;color:#666;font-size:13px">${SIGN_OFF}</p>`,
    `</div>`,
  ].join("");
}

function textOf(heading: string, lines: string[], cta?: { label: string; url: string }): string {
  return [heading, "", ...lines, cta ? `\n${cta.label}: ${cta.url}` : "", "", SIGN_OFF]
    .filter((l) => l !== undefined)
    .join("\n");
}

const money = (p?: number) => (typeof p === "number" ? formatPence(p) : "-");

export function renderEmail(template: EmailTemplate, p: EmailPayload): RenderedEmail {
  const name = p.firstName ?? "there";
  const trip = p.tripName ?? "your trip";
  const ref = p.reference ?? "-";

  switch (template) {
    case "booking_confirmed": {
      const heading = `You're going to ${trip}`;
      // The deposit splits: what reduces the trip balance, and what is held and
      // returned. Students query this constantly, so spell out both halves.
      const towardsTrip =
        typeof p.amountPaid === "number" ? p.amountPaid - (p.damageDeposit ?? 0) : undefined;
      const lines = [
        `Hi ${name}, your place is confirmed.`,
        `We've taken <strong>${money(p.amountPaid)}</strong>: ${money(towardsTrip)} towards your trip, and <strong>${money(p.damageDeposit)}</strong> held as a refundable damage deposit which is returned after the trip.`,
        `Your balance is <strong>${money(p.balance)}</strong>${p.balanceDueDate ? `, due by ${p.balanceDueDate}` : ""}.`,
        `Booking reference: <strong>${ref}</strong>`,
      ];
      return {
        subject: `Confirmed: ${trip} (${ref})`,
        html: shell(heading, lines, p.ticketsUrl ? { label: "View your booking", url: p.ticketsUrl } : undefined),
        text: textOf(heading, lines.map(stripTags), p.ticketsUrl ? { label: "View your booking", url: p.ticketsUrl } : undefined),
      };
    }

    case "payment_receipt": {
      const paidInFull = p.kind === "full" || p.balance === 0;
      const heading = paidInFull ? "You're all paid up" : "Payment received";
      const lines = [
        `Hi ${name}, thanks - we've received <strong>${money(p.amountPaid)}</strong> for ${trip}.`,
        paidInFull
          ? `Your balance is now <strong>£0</strong>. Your tickets are ready.`
          : `Your remaining balance is <strong>${money(p.balance)}</strong>${p.balanceDueDate ? `, due by ${p.balanceDueDate}` : ""}.`,
        `Booking reference: <strong>${ref}</strong>`,
      ];
      return {
        subject: `Payment received - ${trip} (${ref})`,
        html: shell(heading, lines, p.ticketsUrl ? { label: paidInFull ? "Get your tickets" : "View your booking", url: p.ticketsUrl } : undefined),
        text: textOf(heading, lines.map(stripTags), p.ticketsUrl ? { label: paidInFull ? "Get your tickets" : "View your booking", url: p.ticketsUrl } : undefined),
      };
    }

    case "waitlisted": {
      const heading = `You're on the waiting list for ${trip}`;
      const lines = [
        `Hi ${name}, ${trip} filled up just before your payment went through, so you're on the waiting list.`,
        `We've refunded <strong>${money(p.amountPaid)}</strong> in full - it takes 5 to 10 working days to appear, depending on your bank.`,
        `You keep your place in the queue. If someone drops out we'll email you straight away.`,
        `Booking reference: <strong>${ref}</strong>`,
      ];
      return { subject: `Waiting list - ${trip} (${ref})`, html: shell(heading, lines), text: textOf(heading, lines.map(stripTags)) };
    }

    case "waitlist_promoted": {
      const heading = "A place has opened up";
      const lines = [
        `Hi ${name}, good news - a place on ${trip} is yours if you still want it.`,
        `Your booking is live again and your balance is <strong>${money(p.balance)}</strong>${p.balanceDueDate ? `, due by ${p.balanceDueDate}` : ""}.`,
        `Booking reference: <strong>${ref}</strong>`,
      ];
      const cta = p.ticketsUrl ? { label: "Complete your booking", url: p.ticketsUrl } : undefined;
      return { subject: `A place has opened up on ${trip}`, html: shell(heading, lines, cta), text: textOf(heading, lines.map(stripTags), cta) };
    }

    case "balance_reminder": {
      const heading = "Your trip balance is due soon";
      const lines = [
        `Hi ${name}, a reminder that <strong>${money(p.balance)}</strong> is outstanding on ${trip}${p.balanceDueDate ? `, due by <strong>${p.balanceDueDate}</strong>` : ""}.`,
        `Booking reference: <strong>${ref}</strong>`,
      ];
      const cta = p.ticketsUrl ? { label: "Pay your balance", url: p.ticketsUrl } : undefined;
      return { subject: `Balance due - ${trip} (${ref})`, html: shell(heading, lines, cta), text: textOf(heading, lines.map(stripTags), cta) };
    }

    case "damage_deposit_refunded": {
      const heading = "Your damage deposit is on its way back";
      const withheld = p.withheld && p.withheld > 0;
      const lines = [
        `Hi ${name}, thanks for coming on ${trip}.`,
        withheld
          ? `We've refunded <strong>${money(p.amountPaid)}</strong> of your ${money(p.damageDeposit)} damage deposit. ${money(p.withheld)} was withheld; your organiser will have been in touch about why.`
          : `We've refunded your <strong>${money(p.amountPaid)}</strong> damage deposit in full.`,
        `It takes 5 to 10 working days to reach your account, depending on your bank.`,
        `Booking reference: <strong>${ref}</strong>`,
      ];
      return { subject: `Damage deposit refunded - ${trip} (${ref})`, html: shell(heading, lines), text: textOf(heading, lines.map(stripTags)) };
    }
  }
}

/** The HTML lines carry <strong> for emphasis; the text part must not. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}
