import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

describe("crypto secret helpers", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "unit-test-secret-with-at-least-32-characters-001");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("encrypts and decrypts tokens using AES-256-GCM with random IVs", () => {
    const a = encryptSecret("tok_abc_123");
    const b = encryptSecret("tok_abc_123");
    expect(a.startsWith("enc:v1:")).toBe(true);
    expect(b.startsWith("enc:v1:")).toBe(true);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("tok_abc_123");
    expect(decryptSecret(b)).toBe("tok_abc_123");
  });

  it("is idempotent on already-encrypted secrets", () => {
    const encrypted = encryptSecret("refresh_xyz");
    expect(encryptSecret(encrypted)).toBe(encrypted);
  });

  it("passes legacy plaintext secrets through transparently on decrypt", () => {
    expect(decryptSecret("legacy-plain-token")).toBe("legacy-plain-token");
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
  });

  it("rejects tampered ciphertexts", () => {
    const encrypted = encryptSecret("secret-value");
    const tampered = `${encrypted.slice(0, -4)}AAAA`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
