/**
 * The money model, as a pure function. Integer pence throughout.
 * Mirrors the DB's compute_trip_cost / record_payment_and_finalize so the
 * sidebar total, the payment intent, and the ledger all agree.
 *
 * Trip cost C   = base_price + Σ(extra line items)
 * Deposit today = deposit_amount (£150) = downpayment (£50, → trip) + damage (£100, held)
 * Balance after deposit = C − downpayment
 * Pay in full today     = C + damage_deposit
 */

export interface PricingLineItem {
  label: string;
  amount: number; // pence (price_at_booking × quantity)
}

export interface PricingInput {
  basePrice: number;
  depositAmount: number;
  downpaymentAmount: number;
  damageDepositAmount: number;
  extras: PricingLineItem[];
}

export interface Pricing {
  lineItems: PricingLineItem[]; // base place first, then extras
  tripCost: number;
  depositToday: number;
  downpayment: number;
  damageDeposit: number;
  balanceAfterDeposit: number;
  payInFullToday: number;
}

export function computePricing(input: PricingInput): Pricing {
  const extrasTotal = input.extras.reduce((sum, li) => sum + li.amount, 0);
  const tripCost = input.basePrice + extrasTotal;
  return {
    lineItems: [
      { label: "Your place on the trip", amount: input.basePrice },
      ...input.extras,
    ],
    tripCost,
    depositToday: input.depositAmount,
    downpayment: input.downpaymentAmount,
    damageDeposit: input.damageDepositAmount,
    balanceAfterDeposit: tripCost - input.downpaymentAmount,
    payInFullToday: tripCost + input.damageDepositAmount,
  };
}
