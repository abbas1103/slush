import { describe, expect, it, vi } from "vitest";
import { assertRead, computePaidToTrip, type LedgerRow } from "./queries";

// The module also exports the dashboard queries, which pull in the request-scoped
// Supabase client; only the pure money helpers are under test here.
vi.mock("@/lib/supabase/server", () => ({ createClient: () => Promise.resolve(null) }));

/**
 * computePaidToTrip is the single TypeScript implementation of the DB's
 * public.booking_trip_paid, and the two must not drift: the dashboard, the admin
 * bookings table, the finance CSV and the CRM push all read it. The case that
 * matters most is a refunded waiting-list student, who used to be reported as
 * having paid £50 and owing £389 on a trip they got all their money back from.
 */

const DOWNPAYMENT = 5000; // £50 of the £150 deposit is trip money

function row(type: string, amount: number, status = "succeeded"): LedgerRow {
  return { type, amount, status };
}

describe("computePaidToTrip", () => {
  it("counts nothing for a booking with no payments", () => {
    expect(computePaidToTrip([], DOWNPAYMENT)).toBe(0);
  });

  it("counts the downpayment part of a deposit", () => {
    // The ledger's 'deposit' row already holds the £50, not the £150 charged.
    expect(computePaidToTrip([row("deposit", 5000)], DOWNPAYMENT)).toBe(5000);
  });

  it("never counts the damage deposit as trip money", () => {
    const ledger = [row("deposit", 5000), row("damage_deposit_hold", 10000)];
    expect(computePaidToTrip(ledger, DOWNPAYMENT)).toBe(5000);
  });

  it("adds balance top-ups", () => {
    const ledger = [row("deposit", 5000), row("balance", 20000), row("balance", 18900)];
    expect(computePaidToTrip(ledger, DOWNPAYMENT)).toBe(43900); // the £439 trip is clear
  });

  it("counts the trip money captured by a pay-in-full charge", () => {
    // finalize records charge - damage as the 'deposit' row, so £539 lands as £439.
    const ledger = [row("deposit", 43900), row("damage_deposit_hold", 10000)];
    expect(computePaidToTrip(ledger, DOWNPAYMENT)).toBe(43900);
  });

  it("ignores rows that did not succeed", () => {
    const ledger = [
      row("deposit", 5000),
      row("balance", 20000, "pending"),
      row("balance", 15000, "failed"),
      row("balance", 9900, "refunded"),
    ];
    expect(computePaidToTrip(ledger, DOWNPAYMENT)).toBe(5000);
  });

  it("ignores a damage-deposit refund, which was never trip money", () => {
    const ledger = [
      row("deposit", 5000),
      row("damage_deposit_hold", 10000),
      row("damage_deposit_refund", 10000),
    ];
    expect(computePaidToTrip(ledger, DOWNPAYMENT)).toBe(5000);
  });

  it("returns zero for a refunded waiting-list student", () => {
    // The whole £150 came back: £50 of it had counted toward the trip.
    const ledger = [
      row("deposit", 5000),
      row("damage_deposit_hold", 10000),
      row("waitlist_refund", 15000),
    ];
    expect(computePaidToTrip(ledger, DOWNPAYMENT)).toBe(0);
  });

  it("unwinds at most the downpayment per refund row, as the DB function does", () => {
    // least(p.amount, t.downpayment_amount) in booking_trip_paid: the refund also
    // returns the £100 damage deposit, which was never trip money, so the
    // subtraction is capped at £50 rather than unwinding the whole refund.
    const ledger = [row("deposit", 5000), row("balance", 20000), row("waitlist_refund", 15000)];
    expect(computePaidToTrip(ledger, DOWNPAYMENT)).toBe(20000);
  });

  it("uses the trip's own downpayment, not a hardcoded £50", () => {
    const ledger = [row("deposit", 7500), row("waitlist_refund", 20000)];
    expect(computePaidToTrip(ledger, 7500)).toBe(0);
  });

  it("ignores a refund that has not succeeded yet", () => {
    const ledger = [row("deposit", 5000), row("waitlist_refund", 15000, "pending")];
    expect(computePaidToTrip(ledger, DOWNPAYMENT)).toBe(5000);
  });

  it("works on rows in any order and does not mutate them", () => {
    const ledger = [
      row("waitlist_refund", 15000),
      row("damage_deposit_hold", 10000),
      row("deposit", 5000),
    ];
    const snapshot = JSON.stringify(ledger);
    expect(computePaidToTrip(ledger, DOWNPAYMENT)).toBe(0);
    expect(JSON.stringify(ledger)).toBe(snapshot);
  });

  it("stays in whole pence", () => {
    const total = computePaidToTrip([row("deposit", 5000), row("balance", 18901)], DOWNPAYMENT);
    expect(total).toBe(23901);
    expect(Number.isInteger(total)).toBe(true);
  });
});

describe("assertRead", () => {
  it("passes a successful read through", () => {
    expect(() => assertRead(null, "your booking")).not.toThrow();
  });

  it("turns a failed read into an error naming what could not be loaded", () => {
    // Swallowed, this is what shows a student who has just paid an empty
    // dashboard or a bare 404 instead of their booking.
    expect(() => assertRead({ message: "statement timeout" }, "your payments")).toThrow(
      /your payments/,
    );
    expect(() => assertRead({ message: "statement timeout" }, "your payments")).toThrow(
      /statement timeout/,
    );
  });
});
