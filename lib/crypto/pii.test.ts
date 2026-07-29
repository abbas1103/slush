import { afterAll, beforeEach, describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptPII, decryptPII } from "./pii";

/**
 * Passport numbers, DOBs, phone numbers and access needs go through here, so the
 * properties tested are the ones a DB compromise or a corrupt row depends on:
 * a fresh IV every write, an auth tag that refuses tampered or wrong-key values,
 * the documented null behaviour, and a loud failure when the key itself is
 * missing. Keys are generated per run - no fixture key is ever committed.
 */

const CURRENT = randomBytes(32).toString("base64");
const RETIRED = randomBytes(32).toString("base64");
const originalKey = process.env.PII_ENCRYPTION_KEY;
const originalRetired = process.env.PII_ENCRYPTION_KEY_RETIRED;

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  setEnv("PII_ENCRYPTION_KEY", CURRENT);
  setEnv("PII_ENCRYPTION_KEY_RETIRED", undefined);
});

afterAll(() => {
  setEnv("PII_ENCRYPTION_KEY", originalKey);
  setEnv("PII_ENCRYPTION_KEY_RETIRED", originalRetired);
});

/** Flip a byte of the stored blob (ciphertext body or, at -1, the auth tag). */
function tamper(value: string, index: number): string {
  const [version, iv, blob] = value.split(":");
  const bytes = Buffer.from(blob, "base64");
  const at = index < 0 ? bytes.length + index : index;
  bytes[at] ^= 0xff;
  return `${version}:${iv}:${bytes.toString("base64")}`;
}

describe("PII encryption (AES-256-GCM)", () => {
  it("round-trips and never leaks the plaintext", () => {
    const ct = encryptPII("X1234567");
    expect(ct).toMatch(/^v1:/);
    expect(ct).not.toContain("X1234567");
    // Nor a base64 rendering of it - "encrypted" must not mean "encoded".
    expect(ct).not.toContain(Buffer.from("X1234567", "utf8").toString("base64").replace(/=+$/, ""));
    expect(decryptPII(ct)).toBe("X1234567");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptPII("same")).not.toBe(encryptPII("same"));
  });

  it("never reuses an IV across many writes of the same value", () => {
    const ivs = new Set<string>();
    const blobs = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const parts = encryptPII("X1234567")!.split(":");
      ivs.add(parts[1]);
      blobs.add(parts[2]);
    }
    expect(ivs.size).toBe(200); // an IV reuse under one key breaks GCM outright
    expect(blobs.size).toBe(200);
  });

  it("stores v1:<12-byte iv>:<ciphertext+16-byte tag>", () => {
    const plaintext = "AB1234567";
    const parts = encryptPII(plaintext)!.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64")).toHaveLength(
      Buffer.byteLength(plaintext, "utf8") + 16,
    );
  });

  it("round-trips the field shapes the details form actually submits", () => {
    const values = [
      "X1234567", // passport
      "2001-03-12", // dob (stored as ciphertext, not a date)
      "+44 7700 900123", // phone
      " ", // whitespace only - not empty, so it is encrypted
      "Ünïcodé nàme 😀", // multi-byte
      "Nut allergy, needs a ground-floor room. ".repeat(50), // long access needs
    ];
    for (const value of values) {
      const ct = encryptPII(value)!;
      expect(ct).not.toContain(value);
      expect(decryptPII(ct)).toBe(value);
    }
  });

  it("treats empty/null as null (nullable columns stay null)", () => {
    expect(encryptPII("")).toBeNull();
    expect(encryptPII(null)).toBeNull();
    expect(encryptPII(undefined)).toBeNull();
    expect(decryptPII(null)).toBeNull();
    expect(decryptPII(undefined)).toBeNull();
    expect(decryptPII("")).toBeNull();
    expect(decryptPII("garbage")).toBeNull();
  });

  it("returns null for anything that is not a v1 value", () => {
    for (const value of [
      "plaintext phone number", // a client wrote the column directly
      "v1:onlytwoparts",
      "v2:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbb", // unknown format version
      "v1:a:b:c", // four parts
      "v1::", // empty iv and blob
      ":a:b",
    ]) {
      expect(decryptPII(value)).toBeNull();
    }
  });

  it("refuses a tampered value instead of returning forged plaintext", () => {
    const ct = encryptPII("X1234567")!;
    const [, iv, blob] = ct.split(":");
    const shortBlob = Buffer.from(blob, "base64").subarray(0, 8).toString("base64");
    const candidates = [
      tamper(ct, 0), // ciphertext body flipped
      tamper(ct, -1), // auth tag flipped
      `v1:${randomBytes(12).toString("base64")}:${blob}`, // different iv
      `v1:${randomBytes(11).toString("base64")}:${blob}`, // short iv
      `v1:${iv}:${shortBlob}`, // truncated below the tag length
    ];
    for (const candidate of candidates) {
      expect(decryptPII(candidate)).toBeNull();
    }
  });

  it("cannot be read with a different key", () => {
    const ct = encryptPII("X1234567")!;
    setEnv("PII_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(decryptPII(ct)).toBeNull();
  });

  it("reads rows written under a retired key while the new key rolls out", () => {
    const old = encryptPII("X1234567")!;
    setEnv("PII_ENCRYPTION_KEY", RETIRED);
    setEnv("PII_ENCRYPTION_KEY_RETIRED", `${CURRENT} , `);
    expect(decryptPII(old)).toBe("X1234567"); // old row still readable
    const fresh = encryptPII("Y7654321")!;
    setEnv("PII_ENCRYPTION_KEY_RETIRED", undefined);
    expect(decryptPII(fresh)).toBe("Y7654321"); // writes used the current key
  });

  it("ignores an unusable retired key rather than failing every read", () => {
    const ct = encryptPII("X1234567")!;
    setEnv("PII_ENCRYPTION_KEY_RETIRED", "not-a-32-byte-key");
    expect(decryptPII(ct)).toBe("X1234567");
  });

  it("fails loudly when the key is missing or the wrong length", () => {
    const ct = encryptPII("X1234567")!;
    setEnv("PII_ENCRYPTION_KEY", undefined);
    expect(() => encryptPII("X1234567")).toThrow(/PII_ENCRYPTION_KEY is not set/);
    expect(() => decryptPII(ct)).toThrow(/PII_ENCRYPTION_KEY is not set/);
    expect(decryptPII(null)).toBeNull(); // no key needed to skip a null column

    setEnv("PII_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => encryptPII("X1234567")).toThrow(/32-byte key/);
    expect(() => decryptPII(ct)).toThrow(/32-byte key/);
  });
});
