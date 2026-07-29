import { describe, it, expect } from "vitest";
import { computePricing } from "./compute";

/**
 * The money model, pinned to the brief's worked example in explicit constants.
 * Expectations are independently-derived numbers, not relationships between two
 * of the function's own outputs - depositToday, downpayment and damageDeposit
 * are pass-throughs, so an identity like `downpayment + damage === deposit`
 * restates the fixture and can never fail whatever the implementation does.
 *
 * The ledger rules these totals feed are in record_payment_and_finalize
 * (supabase/migrations/20260715091400_audit_hardening.sql:70-88):
 *   deposit -> payments 'deposit' = downpayment, 'damage_deposit_hold' = damage
 *   full    -> payments 'deposit' = charge - damage (NOT a fresh trip cost)
 */

// Brumski Christmas Trip: £439 place, £150 deposit = £50 down + £100 damage.
const base = {
  basePrice: 43900,
  depositAmount: 15000,
  downpaymentAmount: 5000,
  damageDepositAmount: 10000,
};

// A second trip whose split differs, so nothing passes by coincidence of
// 5000/10000: £200 deposit = £75 down + £125 damage on a £500 place.
const otherTrip = {
  basePrice: 50000,
  depositAmount: 20000,
  downpaymentAmount: 7500,
  damageDepositAmount: 12500,
};

describe("computePricing (the money model)", () => {
  it("base trip only - matches the brief's worked example", () => {
    const p = computePricing({ ...base, extras: [] });
    expect(p.tripCost).toBe(43900); // £439
    expect(p.depositToday).toBe(15000); // £150 = £50 + £100
    expect(p.downpayment).toBe(5000);
    expect(p.damageDeposit).toBe(10000);
    expect(p.balanceAfterDeposit).toBe(38900); // £389 = C - £50
    expect(p.payInFullToday).toBe(53900); // £539 = C + £100
    expect(p.lineItems).toHaveLength(1);
    expect(p.lineItems[0]).toEqual({ label: "Your place on the trip", amount: 43900 });
  });

  it("with coach (£239) + winter-sports cover (£42)", () => {
    const p = computePricing({
      ...base,
      extras: [
        { label: "Coach", amount: 23900 },
        { label: "Winter sports cover", amount: 4200 },
      ],
    });
    expect(p.tripCost).toBe(72000); // 43900 + 23900 + 4200
    expect(p.balanceAfterDeposit).toBe(67000); // - £50
    expect(p.payInFullToday).toBe(82000); // + £100
    expect(p.lineItems).toHaveLength(3);
    expect(p.lineItems.map((li) => li.label)).toEqual([
      "Your place on the trip",
      "Coach",
      "Winter sports cover",
    ]);
    expect(p.lineItems.map((li) => li.amount)).toEqual([43900, 23900, 4200]);
  });

  it("reads the deposit split from the trip, not from the £150/£50/£100 defaults", () => {
    const p = computePricing({ ...otherTrip, extras: [{ label: "Coach", amount: 20000 }] });
    expect(p.tripCost).toBe(70000); // 50000 + 20000
    expect(p.depositToday).toBe(20000); // £200 charged today
    expect(p.downpayment).toBe(7500); // only £75 of it is trip money
    expect(p.damageDeposit).toBe(12500);
    expect(p.balanceAfterDeposit).toBe(62500); // 70000 - 7500, NOT 70000 - 20000
    expect(p.payInFullToday).toBe(82500); // 70000 + 12500
  });

  it("charges the same deposit however many extras are chosen", () => {
    const none = computePricing({ ...base, extras: [] });
    const many = computePricing({
      ...base,
      extras: [
        { label: "Coach", amount: 23900 },
        { label: "Ski hire - premium", amount: 12000 },
        { label: "Lessons", amount: 8500 },
      ],
    });
    expect(none.depositToday).toBe(15000);
    expect(many.depositToday).toBe(15000); // flat, never a share of C
    expect(many.tripCost).toBe(88300); // 43900 + 23900 + 12000 + 8500
    expect(many.balanceAfterDeposit).toBe(83300); // the extras land in the balance
  });

  it("counts a zero-cost extra as a line item without changing the total", () => {
    const p = computePricing({
      ...base,
      extras: [{ label: "Airport transfer (included)", amount: 0 }],
    });
    expect(p.tripCost).toBe(43900);
    expect(p.balanceAfterDeposit).toBe(38900);
    expect(p.lineItems).toHaveLength(2); // still shown on the sidebar
    expect(p.lineItems[1]).toEqual({ label: "Airport transfer (included)", amount: 0 });
  });

  it("handles extras worth more than the place itself", () => {
    const p = computePricing({
      ...base,
      extras: [
        { label: "Coach", amount: 23900 },
        { label: "Ski hire - premium", amount: 15000 },
        { label: "Lessons - 5 day", amount: 12000 },
      ],
    });
    expect(p.tripCost).toBe(94800); // extras 50900 > base 43900
    expect(p.depositToday).toBe(15000);
    expect(p.balanceAfterDeposit).toBe(89800);
    expect(p.payInFullToday).toBe(104800);
  });

  it("keeps every total in whole pence", () => {
    const p = computePricing({
      ...base,
      extras: [
        { label: "Coach", amount: 23900 },
        { label: "Winter sports cover", amount: 4200 },
      ],
    });
    for (const value of [
      p.tripCost,
      p.depositToday,
      p.downpayment,
      p.damageDeposit,
      p.balanceAfterDeposit,
      p.payInFullToday,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("does not mutate the caller's extras", () => {
    const extras = [{ label: "Coach", amount: 23900 }];
    const p = computePricing({ ...base, extras });
    p.lineItems.push({ label: "Injected", amount: 99999 });
    expect(extras).toEqual([{ label: "Coach", amount: 23900 }]);
    expect(computePricing({ ...base, extras }).tripCost).toBe(67800);
  });
});

describe("the money model against the ledger", () => {
  it("deposit: £50 becomes trip money, £100 is held, £389 stays owed", () => {
    const p = computePricing({ ...base, extras: [] });
    // record_payment_and_finalize writes 'deposit' = downpayment and
    // 'damage_deposit_hold' = damage for a £150 charge.
    expect(p.depositToday).toBe(15000);
    expect(p.downpayment).toBe(5000); // the only part booking_trip_paid counts
    expect(p.damageDeposit).toBe(10000); // held separately, never trip money
    expect(p.balanceAfterDeposit).toBe(38900); // C - 5000
  });

  it("pay in full: the charge minus the damage hold clears the trip cost exactly", () => {
    const p = computePricing({ ...base, extras: [{ label: "Coach", amount: 23900 }] });
    expect(p.tripCost).toBe(67800);
    expect(p.payInFullToday).toBe(77800);
    // The ledger records charge - damage as trip money (audit #1: NOT a fresh
    // compute_trip_cost). On an unchanged booking that must land on C exactly,
    // leaving a zero balance.
    const tripMoneyRecorded = p.payInFullToday - p.damageDeposit;
    expect(tripMoneyRecorded).toBe(67800);
    expect(p.tripCost - tripMoneyRecorded).toBe(0);
  });

  it("pay in full: extras added after the intent was minted stay owed, not free", () => {
    const atMint = computePricing({ ...base, extras: [] });
    const afterUpsell = computePricing({
      ...base,
      extras: [{ label: "Ski hire - premium", amount: 12000 }],
    });
    expect(atMint.payInFullToday).toBe(53900); // what the card was charged
    expect(afterUpsell.tripCost).toBe(55900); // what the trip now costs
    const tripMoneyRecorded = atMint.payInFullToday - atMint.damageDeposit;
    expect(tripMoneyRecorded).toBe(43900); // 53900 - 10000, taken from the charge
    // The upsell stays owed. Recomputing the cost at finalize instead would
    // have recorded 55900 and handed over a £120 upgrade for nothing.
    expect(afterUpsell.tripCost - tripMoneyRecorded).toBe(12000);
  });

  it("waitlist refund returns the whole £150, downpayment included", () => {
    const p = computePricing({ ...base, extras: [{ label: "Coach", amount: 23900 }] });
    // refundWaitlist returns everything captured; for a deposit-only waitlister
    // that is the £150 charged today, of which £50 was trip money - which is
    // why booking_trip_paid subtracts the downpayment back off again.
    expect(p.depositToday).toBe(15000);
    expect(p.downpayment).toBe(5000);
    expect(p.damageDeposit).toBe(10000);
  });

  it("a pay-in-full waitlister is owed far more than the flat £150 deposit", () => {
    const p = computePricing({ ...base, extras: [{ label: "Coach", amount: 23900 }] });
    // Refund exposure per waitlister is what they actually paid, so a flat
    // count x deposit_amount understates the liability by this much.
    expect(p.payInFullToday).toBe(77800);
    expect(p.payInFullToday - p.depositToday).toBe(62800);
  });
});
