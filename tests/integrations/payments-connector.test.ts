import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConsolePaymentsAdapter,
  StripePaymentsAdapter,
} from "@/modules/integrations/payments/payments-adapters";
import {
  getPaymentsAdapterDefinition,
  instantiatePaymentsAdapter,
  PAYMENTS_ADAPTER_DEFINITIONS,
} from "@/modules/integrations/payments/payments-connector-service";

const fetchCalls: string[] = [];
let fetchResult: unknown = null;

beforeEach(() => {
  fetchCalls.length = 0;
  fetchResult = null;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    fetchCalls.push(String(url));
    fetchCalls.push(String(init?.body));
    return {
      ok: true,
      json: () => Promise.resolve(fetchResult),
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setStripeSession(body: unknown) {
  fetchResult = body;
}

describe("console payments adapter", () => {
  it("creates a deterministic demo link without network", async () => {
    const adapter = new ConsolePaymentsAdapter();
    const link = await adapter.createPaymentLink({
      amountMinor: 150_00,
      currency: "USD",
      description: "Invoice INV-1",
      reference: "inv-1",
      returnUrl: "https://shop.example.test/app/x/work-orders/y",
    });

    expect(fetchCalls).toHaveLength(0);
    expect(link.providerRef).toBe("console_inv-1_15000");
    expect(link.url).toContain("https://pay.shopos.test/demo/");
    expect(link.url).toContain("console_inv-1_15000");
  });
});

describe("stripe payments adapter", () => {
  const adapter = new StripePaymentsAdapter({ secretKey: "sk_test_123" });

  it("creates a checkout session with the balance, currency, and invoice reference", async () => {
    setStripeSession({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" });

    const link = await adapter.createPaymentLink({
      amountMinor: 24_50,
      currency: "USD",
      description: "Invoice INV-1001",
      reference: "inv-abc",
      returnUrl: "https://shop.example.test/portal",
    });

    expect(fetchCalls[0]).toBe("https://api.stripe.com/v1/checkout/sessions");
    const body = new URLSearchParams(fetchCalls[1]!);
    expect(body.get("mode")).toBe("payment");
    expect(body.get("client_reference_id")).toBe("inv-abc");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2450");
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(body.get("line_items[0][price_data][product_data][name]")).toBe("Invoice INV-1001");
    expect(body.get("success_url")).toBe("https://shop.example.test/portal");

    expect(link).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      providerRef: "cs_test_123",
    });
  });

  it("fails loudly when stripe rejects or returns no url", async () => {
    // Non-ok response
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 402 }) as unknown as Response);
    await expect(
      adapter.createPaymentLink({
        amountMinor: 100,
        currency: "USD",
        description: "x",
        reference: "r",
        returnUrl: "https://x.test",
      }),
    ).rejects.toThrowError(/stripe_create_payment_link_failed_402/);

    // OK response without a url
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      async () =>
        ({
          ok: true,
          json: () => Promise.resolve({ id: "cs_1", url: null }),
        }) as unknown as Response,
    );
    await expect(
      adapter.createPaymentLink({
        amountMinor: 100,
        currency: "USD",
        description: "x",
        reference: "r",
        returnUrl: "https://x.test",
      }),
    ).rejects.toThrowError(/missing_url/);
  });
});

describe("payments adapter definitions", () => {
  it("registers stripe with a write-only secret key", () => {
    expect(PAYMENTS_ADAPTER_DEFINITIONS.map((d) => d.key)).toEqual(["stripe"]);
    const stripe = getPaymentsAdapterDefinition("stripe");
    expect(stripe?.secretFields[0]).toMatchObject({
      name: "secretKey",
      type: "password",
      required: true,
    });
  });

  it("instantiates from secrets and refuses missing or unknown adapters", () => {
    expect(instantiatePaymentsAdapter("stripe", { secretKey: "sk" })).toBeInstanceOf(
      StripePaymentsAdapter,
    );
    expect(instantiatePaymentsAdapter("stripe", {})).toBeNull();
    expect(instantiatePaymentsAdapter("chase", { apiKey: "x" })).toBeNull();
  });
});
