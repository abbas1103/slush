import "server-only";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";

/**
 * Ticket identity and QR rendering.
 *
 * There is deliberately no signing here any more. The previous design HMAC'd
 * `bookingId.ticketId.exp` so a scanner could verify offline, but a signature
 * proves only that WE ISSUED IT - never that the booking is still entitled (a
 * refunded student's token stayed cryptographically valid for ever) nor that the
 * ticket has already been used. Both answers live in the database, so the scanner
 * queries regardless; and real offline verification would need the signing key on
 * a rep's phone, where one lost handset makes every ticket we ever issue
 * forgeable.
 *
 * So tokens are opaque random strings stored in `ticket_tokens`: revocable,
 * rotatable per ticket, no key management, and no dependency on
 * PII_ENCRYPTION_KEY - whose rotation would otherwise have silently invalidated
 * every ticket in circulation.
 */

/** 256 bits. A bearer credential shown on a screen in a lift queue, not a secret. */
export function newTicketToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The URL a QR encodes. The token goes in the PATH, not a fragment: a fragment is
 * never sent to the server, so it would be silently dropped by the sign-in
 * redirect a rep hits when their session has lapsed. Path costs nothing in
 * practice, because the token grants nothing without a staff session.
 */
export function ticketScanUrl(token: string, siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/scan/${token}`;
}

/**
 * QR at 512px. Rendered large on the tickets page because the hard case is
 * screen-to-screen: another phone's camera reading a dim, reflective, possibly
 * cracked display. 'M' error correction tolerates some of that.
 */
export function ticketQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { margin: 1, width: 512, errorCorrectionLevel: "M" });
}

export interface TicketDescriptor {
  key: string;
  category: string;
  title: string;
  ticketId: string;
  /**
   * Legitimate scans for this ticket. A lift pass is checked once; a return coach
   * is boarded twice, and a single-use ticket would strand everyone on the way
   * home - which is why the scan log counts rather than setting a flag.
   */
  maxScans: number;
}

/** Lift pass always; coach + each event if the extra was bought. */
export function deriveTickets(
  reference: string,
  extras: { type: string; name: string }[],
): TicketDescriptor[] {
  const suffix = reference.split("-").pop() ?? "0000";
  const tickets: TicketDescriptor[] = [
    {
      key: "lift",
      category: "Lift pass",
      title: "6-day lift pass",
      ticketId: `TKT-LP-${suffix}`,
      maxScans: 1,
    },
  ];
  extras
    .filter((e) => e.type === "transport")
    .forEach((e, i) =>
      tickets.push({
        key: `coach-${i}`,
        category: "Coach",
        title: e.name,
        // The index belongs in the ID, not only in `key`. Without it two transport
        // extras produced the SAME ticketId, so scanning one would mark both used
        // - and ticketId is now a uniqueness key in ticket_tokens, which turns a
        // latent bug into a load-bearing one.
        ticketId: `TKT-CO-${i}${suffix}`,
        maxScans: 2, // out and back
      }),
    );
  extras
    .filter((e) => e.type === "event")
    .forEach((e, i) =>
      tickets.push({
        key: `event-${i}`,
        category: "Event",
        title: e.name,
        ticketId: `TKT-EV-${i}${suffix}`,
        maxScans: 1,
      }),
    );
  return tickets;
}
