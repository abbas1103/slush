import "server-only";
import type { CrmAdapter, CrmBooking, CrmContact } from "./types";

/**
 * Default adapter until a CRM is confirmed: logs (no PII - ids/refs/amounts
 * only) and treats the event as delivered. Swap in a real adapter by adding a
 * case below and setting CRM_PROVIDER + CRM_API_KEY/CRM_BASE_URL in env.
 */
class LogCrmAdapter implements CrmAdapter {
  readonly name = "log";
  async upsertContact(c: CrmContact): Promise<void> {
    console.log(`[crm:log] upsertContact externalId=${c.externalId}`);
  }
  async upsertBooking(b: CrmBooking): Promise<void> {
    console.log(`[crm:log] upsertBooking ${b.reference} status=${b.status} balancePence=${b.balancePence}`);
  }
}

export function getCrmAdapter(): CrmAdapter {
  switch ((process.env.CRM_PROVIDER ?? "").toLowerCase()) {
    // case "hubspot":     return new HubSpotCrmAdapter();     // TODO once confirmed
    // case "salesforce":  return new SalesforceCrmAdapter();  // TODO once confirmed
    default:
      return new LogCrmAdapter();
  }
}
