import { beforeAll, describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptPII, decryptPII } from "./pii";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("PII encryption (AES-256-GCM)", () => {
  it("round-trips and never leaks the plaintext", () => {
    const ct = encryptPII("X1234567");
    expect(ct).toMatch(/^v1:/);
    expect(ct).not.toContain("X1234567");
    expect(decryptPII(ct)).toBe("X1234567");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptPII("same")).not.toBe(encryptPII("same"));
  });

  it("treats empty/null as null (nullable columns stay null)", () => {
    expect(encryptPII("")).toBeNull();
    expect(encryptPII(null)).toBeNull();
    expect(decryptPII(null)).toBeNull();
    expect(decryptPII("garbage")).toBeNull();
  });
});
