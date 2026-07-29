import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveTickets, newTicketToken, type TicketDescriptor } from "@/lib/tickets";

/**
 * Ticket tokens: issuance (idempotent) and resolution for the scanner.
 *
 * Service-role only. `ticket_tokens` and `ticket_scans` have RLS on and no client
 * policies, because the scan surface is only safe while it requires a token you
 * physically hold - a student must not be able to enumerate tokens and neither
 * must a rep.
 */

export interface IssuedTicket extends TicketDescriptor {
  token: string;
}

/**
 * Ensure a token row exists for every ticket this booking is entitled to, and
 * return them. Idempotent via the unique (booking_id, ticket_id) constraint, so
 * re-rendering the tickets page reuses rows rather than minting a second live QR
 * for the same entitlement.
 *
 * Called when the tickets page renders an unlocked booking, rather than at
 * payment: entitlement depends on the extras selected, and doing it on read keeps
 * one code path for "what is this student entitled to".
 */
export async function issueTicketTokens(
  bookingId: string,
  reference: string,
  extras: { type: string; name: string }[],
): Promise<IssuedTicket[]> {
  const admin = createAdminClient();
  const wanted = deriveTickets(reference, extras);

  const { data: existing, error: readError } = await admin
    .from("ticket_tokens")
    .select("token, ticket_id")
    .eq("booking_id", bookingId)
    .is("revoked_at", null);
  if (readError) throw new Error(`Could not load your tickets: ${readError.message}`);

  const byTicketId = new Map((existing ?? []).map((r) => [r.ticket_id, r.token]));
  const missing = wanted.filter((t) => !byTicketId.has(t.ticketId));

  if (missing.length > 0) {
    const rows = missing.map((t) => ({
      token: newTicketToken(),
      booking_id: bookingId,
      ticket_id: t.ticketId,
      ticket_type: t.category,
      title: t.title,
      max_scans: t.maxScans,
    }));
    // ignoreDuplicates: two tabs rendering at once both try to insert. The unique
    // constraint decides; the loser reads the winner's row below rather than
    // failing the page.
    const { error: insertError } = await admin
      .from("ticket_tokens")
      .upsert(rows, { onConflict: "booking_id,ticket_id", ignoreDuplicates: true });
    if (insertError) throw new Error(`Could not prepare your tickets: ${insertError.message}`);

    const { data: after, error: afterError } = await admin
      .from("ticket_tokens")
      .select("token, ticket_id")
      .eq("booking_id", bookingId)
      .is("revoked_at", null);
    if (afterError) throw new Error(`Could not load your tickets: ${afterError.message}`);
    for (const r of after ?? []) byTicketId.set(r.ticket_id, r.token);
  }

  return wanted
    .map((t) => ({ ...t, token: byTicketId.get(t.ticketId) }))
    .filter((t): t is IssuedTicket => typeof t.token === "string");
}

export type ScanOutcome = "ok" | "duplicate" | "not_entitled" | "revoked" | "unknown_token";

export interface ScanView {
  outcome: ScanOutcome;
  /** Present for every outcome except unknown_token. */
  ticket?: {
    token: string;
    ticketId: string;
    ticketType: string;
    title: string;
    maxScans: number;
    reference: string;
    studentName: string;
    tripName: string;
    bookingStatus: string;
    scans: { at: string; result: string }[];
  };
}

/** Statuses that entitle a student to travel. Mirrors the tickets page. */
const ENTITLED = new Set(["confirmed", "converted"]);

/**
 * Resolve a token for display. READ ONLY - deliberately records nothing, so a
 * refresh, a browser prefetch or a back button cannot consume a scan. Recording
 * is an explicit action (recordScan).
 *
 * Returns the MINIMUM a rep needs to decide: who, which ticket, are they
 * entitled, has it been used. No passport, no date of birth, no medical needs -
 * a rep holds the paper manifest anyway, and their phone screen should not be a
 * PII disclosure if someone glances at it.
 */
export async function resolveTicketToken(token: string): Promise<ScanView> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("ticket_tokens")
    .select(
      "token, ticket_id, ticket_type, title, max_scans, revoked_at, booking_id, bookings(reference, status, users(first_name, last_name), trips(name))",
    )
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(`Could not check that ticket: ${error.message}`);
  if (!data) return { outcome: "unknown_token" };

  const booking = data.bookings as {
    reference: string;
    status: string;
    users: { first_name: string | null; last_name: string | null } | null;
    trips: { name: string } | null;
  } | null;

  const { data: scans, error: scanError } = await admin
    .from("ticket_scans")
    .select("scanned_at, result")
    .eq("token", token)
    .order("scanned_at", { ascending: false })
    .limit(20);
  if (scanError) throw new Error(`Could not read the scan history: ${scanError.message}`);

  const successful = (scans ?? []).filter((s) => s.result === "ok").length;
  // Live status, never anything baked into the token: a refunded booking must stop
  // working the moment it is refunded, which a signature could never express.
  const entitled = ENTITLED.has(booking?.status ?? "");

  const outcome: ScanOutcome = data.revoked_at
    ? "revoked"
    : !entitled
      ? "not_entitled"
      : successful >= data.max_scans
        ? "duplicate"
        : "ok";

  return {
    outcome,
    ticket: {
      token: data.token,
      ticketId: data.ticket_id,
      ticketType: data.ticket_type,
      title: data.title,
      maxScans: data.max_scans,
      reference: booking?.reference ?? "-",
      studentName:
        `${booking?.users?.first_name ?? ""} ${booking?.users?.last_name ?? ""}`.trim() || "-",
      tripName: booking?.trips?.name ?? "-",
      bookingStatus: booking?.status ?? "-",
      scans: (scans ?? []).map((s) => ({ at: s.scanned_at, result: s.result })),
    },
  };
}

/**
 * Append a scan. Records refusals as well as successes: someone presenting a
 * refunded ticket is precisely what an organiser wants to see afterwards.
 *
 * Append-only, so there is no claim to race. Two reps scanning the same ticket at
 * once both insert, and the second read shows the count exceeded - visible rather
 * than silently destructive.
 */
export async function recordScan(
  token: string,
  scannedBy: string,
): Promise<{ ok: true; outcome: ScanOutcome; view: ScanView } | { ok: false; error: string }> {
  const view = await resolveTicketToken(token);
  if (view.outcome === "unknown_token" || !view.ticket) {
    return { ok: false, error: "That ticket isn't recognised." };
  }

  const admin = createAdminClient();
  // Denormalised onto the scan so the trip-level report does not have to join
  // through ticket_tokens, and so a reissued token keeps its history readable.
  const { data: row, error: rowError } = await admin
    .from("ticket_tokens")
    .select("booking_id")
    .eq("token", token)
    .maybeSingle();
  if (rowError) return { ok: false, error: `Could not record the scan: ${rowError.message}` };
  if (!row) return { ok: false, error: "That ticket isn't recognised." };

  const { error } = await admin.from("ticket_scans").insert({
    token,
    booking_id: row.booking_id,
    scanned_by: scannedBy,
    result: view.outcome,
    metadata: { ticket_id: view.ticket.ticketId, booking_status: view.ticket.bookingStatus },
  });
  if (error) return { ok: false, error: `Could not record the scan: ${error.message}` };

  // Re-read so the caller shows the state INCLUDING this scan.
  return { ok: true, outcome: view.outcome, view: await resolveTicketToken(token) };
}
