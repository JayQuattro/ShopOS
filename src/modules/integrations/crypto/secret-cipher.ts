import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope encryption for connector secrets (ADR 0008).
 *
 * The master key is the installation's root secret-protection bootstrap and
 * comes from the `CONNECTOR_ENCRYPTION_KEY` environment variable (32 bytes,
 * base64). This is the only deployment secret allowed for connector
 * credentials per ADR 0008.
 *
 * Encrypted output format: JSON-encoded string containing base64 iv,
 * base64 ciphertext, and base64 auth tag. Never logged or returned from APIs.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export type EncryptedSecret = Readonly<{
  iv: string;
  ciphertext: string;
  authTag: string;
}>;

export class SecretCipherError extends Error {
  constructor(public readonly reason: "invalid_key" | "invalid_payload" | "decryption_failed") {
    super("The secret could not be encrypted or decrypted.");
    this.name = "SecretCipherError";
  }
}

/**
 * Parses and validates the master key from the environment variable.
 * Expects 32 bytes encoded as base64.
 */
export function parseMasterKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new SecretCipherError("invalid_key");
  }
  return key;
}

/**
 * Generates a new 32-byte master key encoded as base64.
 * Used for initial setup: `pnpm tsx -e "console.log(generateMasterKey())"`
 */
export function generateMasterKey(): string {
  return randomBytes(KEY_LENGTH).toString("base64");
}

/**
 * Encrypts a plaintext secret using AES-256-GCM.
 * Returns a JSON-encoded string suitable for database storage.
 */
export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload: EncryptedSecret = {
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    authTag: authTag.toString("base64"),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypts a JSON-encoded encrypted secret back to plaintext.
 * Throws SecretCipherError on any failure (wrong key, tampered data, etc.).
 */
export function decryptSecret(encryptedPayload: string, masterKey: Buffer): string {
  let parsed: EncryptedSecret;
  try {
    parsed = JSON.parse(encryptedPayload) as EncryptedSecret;
  } catch {
    throw new SecretCipherError("invalid_payload");
  }

  if (!parsed.iv || !parsed.ciphertext || !parsed.authTag) {
    throw new SecretCipherError("invalid_payload");
  }

  try {
    const iv = Buffer.from(parsed.iv, "base64");
    const ciphertext = Buffer.from(parsed.ciphertext, "base64");
    const authTag = Buffer.from(parsed.authTag, "base64");

    const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return decrypted.toString("utf8");
  } catch {
    throw new SecretCipherError("decryption_failed");
  }
}

/**
 * Reads the master key from the environment. Returns null if not configured
 * (self-hosted deployments without connectors configured don't need it).
 */
export function getMasterKeyFromEnv(): Buffer | null {
  const base64Key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!base64Key) return null;
  try {
    return parseMasterKey(base64Key);
  } catch {
    return null;
  }
}
