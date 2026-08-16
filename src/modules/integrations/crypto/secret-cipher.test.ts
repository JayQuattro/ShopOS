import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  generateMasterKey,
  parseMasterKey,
  SecretCipherError,
} from "@/modules/integrations/crypto/secret-cipher";

describe("secret cipher", () => {
  const masterKey = parseMasterKey(generateMasterKey());

  it("round-trips a secret through encrypt and decrypt", () => {
    const plaintext = "my-secret-api-key-12345";
    const encrypted = encryptSecret(plaintext, masterKey);
    const decrypted = decryptSecret(encrypted, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const plaintext = "same-secret";
    const a = encryptSecret(plaintext, masterKey);
    const b = encryptSecret(plaintext, masterKey);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, masterKey)).toBe(plaintext);
    expect(decryptSecret(b, masterKey)).toBe(plaintext);
  });

  it("does not contain the plaintext in the encrypted payload", () => {
    const plaintext = "very-sensitive-password";
    const encrypted = encryptSecret(plaintext, masterKey);
    expect(encrypted).not.toContain(plaintext);
  });

  it("rejects a wrong key", () => {
    const encrypted = encryptSecret("secret", masterKey);
    const wrongKey = parseMasterKey(generateMasterKey());
    expect(() => decryptSecret(encrypted, wrongKey)).toThrowError(SecretCipherError);
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptSecret("secret", masterKey);
    const parsed = JSON.parse(encrypted) as { ciphertext: string };
    parsed.ciphertext = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(JSON.stringify(parsed), masterKey)).toThrowError(SecretCipherError);
  });

  it("rejects invalid JSON payload", () => {
    expect(() => decryptSecret("not-json", masterKey)).toThrowError(SecretCipherError);
  });

  it("rejects missing fields", () => {
    expect(() => decryptSecret(JSON.stringify({ iv: "abc" }), masterKey)).toThrowError(
      SecretCipherError,
    );
  });

  it("rejects a wrong-length master key", () => {
    expect(() => parseMasterKey(Buffer.from("short").toString("base64"))).toThrowError(
      SecretCipherError,
    );
  });

  it("handles complex secrets (JSON objects, unicode, newlines)", () => {
    const complex = JSON.stringify({
      apiKey: "rk_12345",
      username: "user@example.com",
      password: "p@$$w0rd with spaces & symbols\nnewline",
      unicode: "日本語テスト",
    });
    const encrypted = encryptSecret(complex, masterKey);
    expect(decryptSecret(encrypted, masterKey)).toBe(complex);
  });

  it("generateMasterKey produces a valid 32-byte key", () => {
    const key = parseMasterKey(generateMasterKey());
    expect(key.length).toBe(32);
  });
});
