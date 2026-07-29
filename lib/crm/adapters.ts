import "server-only";
import type { CrmAdapter, CrmBooking, CrmContact } from "./types";

/**
 * Per-request timeout for Zoho calls. Without one, a single hung connection
 * consumes the drain's whole wall-clock budget and every other queued event
 * waits for the next cron run. An abort surfaces as a normal failure, so the row
 * is retried with its attempt count incremented rather than lost.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * An adapter plus whether it actually delivers anywhere. The outbox drain must
 * never mark a row 'sent' for an adapter that delivers nothing, or the queue is
 * consumed and there is nothing left to replay once a real CRM is configured
 * (see `delivers` in lib/crm/process.ts).
 */
export type SelectedCrmAdapter = CrmAdapter & { readonly delivers: boolean };

/**
 * Default adapter until a CRM is confirmed: logs (no PII - ids/refs/amounts
 * only). It does NOT deliver, so the drain leaves its events queued. Swap in a
 * real adapter by adding a case below and setting CRM_PROVIDER + the provider's
 * credentials in env.
 */
class LogCrmAdapter implements CrmAdapter {
  readonly name = "log";
  readonly delivers = false;
  async upsertContact(c: CrmContact): Promise<void> {
    console.log(`[crm:log] upsertContact externalId=${c.externalId}`);
  }
  async upsertBooking(b: CrmBooking): Promise<void> {
    console.log(`[crm:log] upsertBooking ${b.reference} status=${b.status} balancePence=${b.balancePence}`);
  }
}

// ── Zoho CRM adapter ────────────────────────────────────────────────────────
// One-way sync: booker -> Zoho Contact (deduped on Email), booking -> Zoho Deal
// (deduped on Deal_Name = our booking reference, so a booking updates in place).
// Auth is OAuth: a long-lived refresh token mints short-lived (~1h) access
// tokens, cached in memory. The data-centre's API domain comes back in the token
// response, so only the ACCOUNTS domain (the DC) needs configuring.
//
// Env (all server-only, never NEXT_PUBLIC_):
//   CRM_PROVIDER=zoho
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
//   ZOHO_ACCOUNTS_URL   e.g. https://accounts.zoho.eu  (DC of the Zoho org;
//                       defaults to https://accounts.zoho.com)
// Data minimisation: only contact basics + booking summary are sent - never
// passport / DOB / medical (those never enter the CRM payload; see lib/crm/types).

type ZohoTokenResponse = {
  access_token?: string;
  api_domain?: string;
  expires_in?: number;
  error?: string;
};
type ZohoRecord = { code?: string; message?: string; details?: { id?: string } };
type ZohoResponse = { data?: ZohoRecord[] };

// Maps a SLUSH booking status to a Zoho Deals pipeline stage. Zoho REJECTS a
// Stage that does not exist in the org's pipeline, so these are Zoho's
// out-of-the-box stage names. If Slush customised their pipeline, change these
// to match their stage names.
const STAGE_MAP: Record<string, string> = {
  pending: "Qualification",
  waitlisted: "Qualification",
  confirmed: "Closed Won",
  converted: "Closed Won",
  cancelled: "Closed Lost",
  refunded: "Closed Lost",
};

class ZohoCrmAdapter implements CrmAdapter {
  readonly name = "zoho";
  readonly delivers = true;
  private token: { accessToken: string; apiDomain: string; expiresAt: number } | null = null;
  // Within one drain, upsertContact runs immediately before upsertBooking for
  // the same booking, so we remember the Zoho contact id to link the deal to it.
  private contactIdByExternal = new Map<string, string>();

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
    private readonly accountsUrl: string,
  ) {}

  private async getToken(): Promise<{ accessToken: string; apiDomain: string }> {
    // Reuse the cached access token until ~1 min before it expires.
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token;
    const body = new URLSearchParams({
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
    });
    const res = await fetch(`${this.accountsUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as ZohoTokenResponse;
    if (!res.ok || !json.access_token) {
      throw new Error(`Zoho token refresh failed (HTTP ${res.status}): ${json.error ?? "no access_token returned"}`);
    }
    this.token = {
      accessToken: json.access_token,
      apiDomain: json.api_domain ?? "https://www.zohoapis.com",
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return this.token;
  }

  private async post(path: string, payload: unknown): Promise<ZohoRecord | undefined> {
    const t = await this.getToken();
    const res = await fetch(`${t.apiDomain}/crm/v6/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${t.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as ZohoResponse;
    if (!res.ok) {
      throw new Error(`Zoho ${path} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    }
    const rec = json.data?.[0];
    // Zoho returns 2xx with a per-record status - a rejected record is still a failure.
    if (rec?.code && rec.code !== "SUCCESS") {
      throw new Error(`Zoho ${path} rejected: ${rec.code} ${rec.message ?? ""}`);
    }
    return rec;
  }

  async upsertContact(c: CrmContact): Promise<void> {
    if (!c.email) throw new Error("Zoho contact needs an email (the upsert dedupe key)");
    // Last_Name is mandatory in Zoho Contacts - fall back so a partial profile still syncs.
    const lastName = c.lastName || c.firstName || c.email.split("@")[0] || "SLUSH contact";
    const rec = await this.post("Contacts/upsert", {
      data: [
        {
          Last_Name: lastName,
          First_Name: c.firstName ?? undefined,
          Email: c.email,
          Phone: c.phone ?? undefined,
          Description: c.universitySociety ? `University / society: ${c.universitySociety}` : undefined,
        },
      ],
      duplicate_check_fields: ["Email"],
    });
    const id = rec?.details?.id;
    if (id) this.contactIdByExternal.set(c.externalId, id);
  }

  async upsertBooking(b: CrmBooking): Promise<void> {
    const deal: Record<string, unknown> = {
      Deal_Name: b.reference,
      Stage: STAGE_MAP[b.status] ?? "Qualification",
      Amount: b.tripCostPence / 100,
      Description:
        `Trip: ${b.tripName}\n` +
        `Status: ${b.status}\n` +
        `Paid to trip: GBP ${(b.paidToTripPence / 100).toFixed(2)}\n` +
        `Balance: GBP ${(b.balancePence / 100).toFixed(2)}\n` +
        `Dates: ${b.startDate} to ${b.endDate}`,
    };
    // Closing_Date is mandatory in Zoho Deals; use the trip end date if present.
    if (b.endDate) deal.Closing_Date = b.endDate;
    const contactId = this.contactIdByExternal.get(b.contactExternalId);
    if (contactId) deal.Contact_Name = { id: contactId };
    await this.post("Deals/upsert", { data: [deal], duplicate_check_fields: ["Deal_Name"] });
  }
}

export function getCrmAdapter(): SelectedCrmAdapter {
  switch ((process.env.CRM_PROVIDER ?? "").toLowerCase()) {
    case "zoho": {
      const clientId = process.env.ZOHO_CLIENT_ID;
      const clientSecret = process.env.ZOHO_CLIENT_SECRET;
      const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
      const accountsUrl = (process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com").replace(/\/+$/, "");
      if (clientId && clientSecret && refreshToken) {
        return new ZohoCrmAdapter(clientId, clientSecret, refreshToken, accountsUrl);
      }
      // Misconfigured -> stay inert (log, delivers=false) rather than crash the
      // outbox drain. Events stay queued until the credentials are fixed.
      console.warn("[crm] CRM_PROVIDER=zoho but ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN not all set - using log adapter");
      return new LogCrmAdapter();
    }
    default:
      return new LogCrmAdapter();
  }
}
