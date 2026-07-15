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
});
