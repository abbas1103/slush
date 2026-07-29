import { describe, it, expect } from "vitest";
import { formatPence } from "./money";

describe("formatPence", () => {
  it("formats pence as GBP", () => {
    expect(formatPence(43900)).toBe("£439.00");
    expect(formatPence(0)).toBe("£0.00");
    expect(formatPence(5)).toBe("£0.05");
  });
  it("strips trailing .00 for compact labels", () => {
    expect(formatPence(15000, { stripZeros: true })).toBe("£150");
    expect(formatPence(15050, { stripZeros: true })).toBe("£150.50");
  });
  it("groups thousands for large admin sums", () => {
    expect(formatPence(4500000, { grouped: true })).toBe("£45,000.00");
  });

  it("renders the amounts the money model actually charges", () => {
    expect(formatPence(15000)).toBe("£150.00"); // deposit today
    expect(formatPence(5000)).toBe("£50.00"); // downpayment
    expect(formatPence(10000)).toBe("£100.00"); // damage deposit
    expect(formatPence(38900)).toBe("£389.00"); // balance after deposit
    expect(formatPence(53900)).toBe("£539.00"); // pay in full
    expect(formatPence(30)).toBe("£0.30"); // Stripe's minimum GBP charge
    expect(formatPence(4200)).toBe("£42.00"); // winter-sports cover
  });

  it("keeps single pence visible and never rounds them away", () => {
    expect(formatPence(1)).toBe("£0.01");
    expect(formatPence(99)).toBe("£0.99");
    expect(formatPence(101)).toBe("£1.01");
    expect(formatPence(38899)).toBe("£388.99");
  });

  it("strips only a trailing .00, never pence in the middle", () => {
    expect(formatPence(100050, { stripZeros: true })).toBe("£1000.50");
    expect(formatPence(4500000, { grouped: true, stripZeros: true })).toBe("£45,000");
    expect(formatPence(105050, { grouped: true, stripZeros: true })).toBe("£1,050.50");
  });

  it("groups only when asked, so pence-exact amounts stay comparable", () => {
    expect(formatPence(105000)).toBe("£1050.00");
    expect(formatPence(105000, { grouped: true })).toBe("£1,050.00");
  });

  it("shows an overpaid balance as negative, never as money still owed", () => {
    // A double-paid balance can leave tripCost - paidToTrip below zero; the
    // student must not be shown that as an amount outstanding.
    const out = formatPence(-20000);
    expect(out).toContain("-");
    expect(out).toContain("200.00");
    expect(formatPence(-1)).toContain("0.01");
  });
});
