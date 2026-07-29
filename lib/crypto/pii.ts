import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-layer encryption for sensitive PII (passport number, insurer policy,
 * access/medical needs). AES-256-GCM with a server-only key. Ciphertext is
 * stored as `v1:<base64 iv>:<base64 ciphertext+tag>`, where `v1` versions the
 * FORMAT (algorithm + layout) so a different scheme can be introduced later and
 * still be told apart on read. The key never touches the database, so a DB
 * compromise yields ciphertext, not plaintext.
 *
 * Key rotation is by key list, not by that prefix (audit #64): writes always use
 * PII_ENCRYPTION_KEY, reads try it first and then each key in
 * PII_ENCRYPTION_KEY_RETIRED (comma-separated base64), so rows written under an
 * older key stay readable while the new key rolls out. The GCM auth tag makes
 * trying keys in turn unambiguous - the wrong key fails the tag.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

function parseKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

/** The current key - the only one writes use. Fails closed when it is missing. */
function getKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) throw new Error("PII_ENCRYPTION_KEY is not set");
  return parseKey(raw);
}

/** Keys to try on read: the current one first, then any retired one. */
function decryptionKeys(): Buffer[] {
  const keys = [getKey()];
  for (const raw of (process.env.PII_ENCRYPTION_KEY_RETIRED ?? "").split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      keys.push(parseKey(trimmed));
    } catch {
      // An unusable retired key must not stop the current key from working.
    }
  }
  return keys;
}

/** Encrypt a value; returns null for empty input so nullable columns stay null. */
export function encryptPII(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${Buffer.concat([ciphertext, tag]).toString("base64")}`;
}

/**
 * Decrypt a `v1:` value. Returns null for null, malformed OR unreadable input -
 * a wrong key, a failed auth tag, a short IV, a truncated ciphertext - so one
 * bad row degrades to a blank field the student can refill, instead of throwing
 * mid-render and 500-ing the whole details page (audit #64). Never logs the
 * value. Still throws when the key itself is missing or the wrong length: that
 * is a deployment fault rather than a data fault, and it must be loud.
 */
export function decryptPII(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const iv = Buffer.from(parts[1], "base64");
  const blob = Buffer.from(parts[2], "base64");
  if (iv.length !== IV_BYTES || blob.length <= TAG_BYTES) return null;
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(0, blob.length - TAG_BYTES);
  for (const key of decryptionKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      // Wrong key or tampered/corrupt value - try the next key, then give up.
    }
  }
  return null;
}
