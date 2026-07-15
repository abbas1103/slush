import { describe, it, expect } from "vitest";
import { computePricing } from "./compute";

const base = {
  basePrice: 43900,
  depositAmount: 15000,
  downpaymentAmount: 5000,
  damageDepositAmount: 10000,
};

describe("computePricing (the money model)", () => {
  it("base trip only — matches the brief's worked example", () => {
    const p = computePricing({ ...base, extras: [] });
    expect(p.tripCost).toBe(43900); // £439
    expect(p.depositToday).toBe(15000); // £150 = £50 + £100
    expect(p.downpayment).toBe(5000);
    expect(p.damageDeposit).toBe(10000);
    expect(p.balanceAfterDeposit).toBe(38900); // £389 = C - £50
    expect(p.payInFullToday).toBe(53900); // £539 = C + £100
    expect(p.lineItems[0].amount).toBe(43900);
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
  });

  it("deposit split always sums to the deposit; damage is separate from trip balance", () => {
    const p = computePricing({ ...base, extras: [{ label: "x", amount: 10000 }] });
    expect(p.downpayment + p.damageDeposit).toBe(p.depositToday);
    // paying the deposit reduces the balance by the downpayment only
    expect(p.tripCost - p.balanceAfterDeposit).toBe(p.downpayment);
  });
});
