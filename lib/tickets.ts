import "server-only";
import { createHmac, hkdfSync } from "node:crypto";
import QRCode from "qrcode";

/**
 * HMAC key for ticket tokens. Derived from the server-only PII key via HKDF so
 * it is purpose-separated from the encryption use of that secret (distinct key
 * bytes), and **fails closed** if the secret is missing — never a hardcoded
 * fallback that would make tokens forgeable (audit #12).
 */
let cachedTicketKey: Buffer | null = null;
function signingKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) throw new Error("PII_ENCRYPTION_KEY is not set — cannot sign ticket tokens");
  if (!cachedTicketKey) {
    cachedTicketKey = Buffer.from(
      hkdfSync("sha256", Buffer.from(raw), new Uint8Array(0), Buffer.from("slush-ticket-hmac"), 32),
    );
  }
  return cachedTicketKey;
}

/**
 * A verifiable ticket token: `bookingId.type.exp.<hmac>`. The resort scanner
 * (future) recomputes the HMAC to validate. Encodes NO personal data.
 */
export function signTicketToken(bookingId: string, ticketType: string, expUnix: number): string {
  const payload = `${bookingId}.${ticketType}.${expUnix}`;
  const sig = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function ticketQrDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, { margin: 1, width: 220 });
}

export interface TicketDescriptor {
  key: string;
  category: string;
  title: string;
  ticketId: string;
}

/** Lift pass always; coach + each event if the extra was bought. */
export function deriveTickets(
  reference: string,
  extras: { type: string; name: string }[],
): TicketDescriptor[] {
  const suffix = reference.split("-").pop() ?? "0000";
  const tickets: TicketDescriptor[] = [
    { key: "lift", category: "Lift pass", title: "6-day lift pass", ticketId: `TKT-LP-${suffix}` },
  ];
  extras
    .filter((e) => e.type === "transport")
    .forEach((e, i) => tickets.push({ key: `coach-${i}`, category: "Coach", title: e.name, ticketId: `TKT-CO-${suffix}` }));
  extras
    .filter((e) => e.type === "event")
    .forEach((e, i) => tickets.push({ key: `event-${i}`, category: "Event", title: e.name, ticketId: `TKT-EV-${i}${suffix}` }));
  return tickets;
}
