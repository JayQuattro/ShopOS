import { describe, expect, it, vi } from "vitest";
import type { AuthDeliveryMessage } from "./auth-delivery-provider";
import { ConsoleAuthDeliveryProvider } from "./console-auth-delivery-provider";
import { NullAuthDeliveryProvider } from "./null-auth-delivery-provider";

const verification: AuthDeliveryMessage = {
  kind: "verification-email",
  to: "owner@example.test",
  url: "https://shopos.example/api/auth/verify-email?token=SECRET-TOKEN",
};

const reset: AuthDeliveryMessage = {
  kind: "password-reset-email",
  to: "owner@example.test",
  url: "https://shopos.example/reset-password?token=RESET-TOKEN",
};

const otp: AuthDeliveryMessage = {
  kind: "email-otp",
  to: "owner@example.test",
  otp: "123456",
  purpose: "sign-in",
};

describe("ConsoleAuthDeliveryProvider", () => {
  it("captures a redacted record without token, url, or otp", () => {
    const provider = new ConsoleAuthDeliveryProvider();
    provider.send(verification);
    provider.send(reset);
    provider.send(otp);

    const captured = provider.capturedMessages();
    expect(captured).toHaveLength(3);
    expect(captured[0]).toEqual(
      expect.objectContaining({ kind: "verification-email", to: "owner@example.test" }),
    );

    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain("SECRET-TOKEN");
    expect(serialized).not.toContain("RESET-TOKEN");
    expect(serialized).not.toContain("123456");
  });

  it("logs a redacted summary that never includes secrets", () => {
    vi.stubEnv("NODE_ENV", "development");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const provider = new ConsoleAuthDeliveryProvider();
      provider.send(verification);
      provider.send(otp);

      const logged = info.mock.calls.map((call) => String(call)).join("\n");
      expect(logged).toContain("verification-email");
      expect(logged).toContain("owner@example.test");
      expect(logged).not.toContain("SECRET-TOKEN");
      expect(logged).not.toContain("123456");
    } finally {
      info.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("does not log in the test environment", () => {
    vi.stubEnv("NODE_ENV", "test");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const provider = new ConsoleAuthDeliveryProvider();
      provider.send(otp);
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("reset clears the capture buffer", () => {
    const provider = new ConsoleAuthDeliveryProvider();
    provider.send(verification);
    provider.reset();
    expect(provider.capturedMessages()).toHaveLength(0);
  });
});

describe("NullAuthDeliveryProvider", () => {
  it("never throws and records a count without leaking state", () => {
    const provider = new NullAuthDeliveryProvider();
    expect(() => provider.send(verification)).not.toThrow();
    expect(() => provider.send(otp)).not.toThrow();
    expect(provider.sentMessages()).toBe(2);
  });
});
