import { describe, it, expect } from "vitest";
import { formatDate, formatDateRange } from "./dates";

/**
 * These strings sit next to the Book button, on the ticket and on the admin
 * overview, so a mislabelled month means a customer turning up a month late.
 * The range separator is looked up by character code so the assertions pin the
 * two ends of the range rather than the choice of dash.
 */
const SEPARATORS = [8211, 8212, 45].map((code) => ` ${String.fromCharCode(code)} `);

function ends(range: string): [string, string] {
  for (const separator of SEPARATORS) {
    const at = range.indexOf(separator);
    if (at !== -1) return [range.slice(0, at), range.slice(at + separator.length)];
  }
  throw new Error(`no range separator in "${range}"`);
}

describe("formatDateRange", () => {
  it("uses the compact form when both ends share a month and year", () => {
    // The Brumski Christmas Trip: Sat 12 to Sat 19 December 2026.
    expect(ends(formatDateRange("2026-12-12", "2026-12-19"))).toEqual([
      "Sat 12",
      "Sat 19 December 2026",
    ]);
  });

  it("names both months when the trip crosses a month boundary", () => {
    const [start, end] = ends(formatDateRange("2026-11-28", "2026-12-05"));
    expect(start).toBe("Sat 28 November 2026");
    expect(end).toBe("Sat 5 December 2026");
  });

  it("names both years for a New Year trip", () => {
    const [start, end] = ends(formatDateRange("2026-12-28", "2027-01-04"));
    expect(start).toBe("Mon 28 December 2026"); // not "Mon 28", which reads as January
    expect(end).toBe("Mon 4 January 2027");
  });

  it("keeps the calendar date it was given, whatever the server timezone", () => {
    // Parsed at local midnight, so 1 January never renders as 31 December.
    expect(ends(formatDateRange("2026-01-01", "2026-01-08"))).toEqual([
      "Thu 1",
      "Thu 8 January 2026",
    ]);
  });
});

describe("formatDate", () => {
  it("formats a single date short", () => {
    expect(formatDate("2026-11-15")).toBe("15 Nov 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("shows a dash for a missing date rather than 'Invalid Date'", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate("")).toBe("-");
  });
});
