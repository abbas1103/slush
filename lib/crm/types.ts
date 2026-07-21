/**
 * CRM-agnostic sync contract. Only the fields a CRM needs for a contact +
 * booking record - deliberately NOT passport/DOB/medical (data minimisation).
 * A concrete CRM (HubSpot / Salesforce / …) implements CrmAdapter.
 */
export interface CrmContact {
  externalId: string; // our user id - the stable key for upsert
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  universitySociety: string | null;
}

export interface CrmBooking {
  reference: string; // stable key for upsert
  contactExternalId: string;
  tripName: string;
  status: string;
  tripCostPence: number;
  paidToTripPence: number;
  balancePence: number;
  startDate: string;
  endDate: string;
}

export interface CrmAdapter {
  readonly name: string;
  upsertContact(contact: CrmContact): Promise<void>;
  upsertBooking(booking: CrmBooking): Promise<void>;
}
