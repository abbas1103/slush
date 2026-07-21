import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-layer encryption for sensitive PII (passport number, insurer policy,
 * access/medical needs). AES-256-GCM with a server-only key. Ciphertext is
 * stored as `v1:<base64 iv>:<base64 ciphertext+tag>` - the version prefix
 * enables key rotation later. The key never touches the database, so a DB
 * compromise yields ciphertext, not plaintext.
 */

function getKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) throw new Error("PII_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

/** Encrypt a value; returns null for empty input so nullable columns stay null. */
export function encryptPII(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${Buffer.concat([ciphertext, tag]).toString("base64")}`;
}

/** Decrypt a `v1:` value. Returns null for null/malformed input. */
export function decryptPII(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const iv = Buffer.from(parts[1], "base64");
  const blob = Buffer.from(parts[2], "base64");
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(0, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
