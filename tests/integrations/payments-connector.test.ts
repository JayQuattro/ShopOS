import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdyenPaymentsAdapter,
  ConsolePaymentsAdapter,
  MolliePaymentsAdapter,
  SquarePaymentsAdapter,
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

describe("square payments adapter", () => {
  const adapter = new SquarePaymentsAdapter({ locationId: "LOC123" }, { accessToken: "EAAA_test" });

  it("creates a quick-pay online checkout link", async () => {
    fetchResult = {
      payment_link: { id: "plink123", url: "https://square.link/u/abc123" },
    };
    const link = await adapter.createPaymentLink({
      amountMinor: 125_00,
      currency: "USD",
      description: "Invoice INV-1",
      reference: "inv-1",
      returnUrl: "https://shop.example.test/portal",
    });

    expect(fetchCalls[0]).toBe("https://connect.squareup.com/v2/online-checkout/payment-links");
    const body = JSON.parse(fetchCalls[1]!);
    expect(body.order.location_id).toBe("LOC123");
    expect(body.order.line_items[0].base_price_money).toEqual({ amount: 12500, currency: "USD" });
    expect(body.idempotency_key).toContain("inv-1");
    expect(link).toEqual({ url: "https://square.link/u/abc123", providerRef: "plink123" });
  });
});

describe("adyen payments adapter", () => {
  const adapter = new AdyenPaymentsAdapter(
    { apiKey: "AQEy_test" },
    { merchantAccount: "ShopECOM" },
  );

  it("creates a Pay by Link through the checkout API", async () => {
    fetchResult = { id: "PL123", url: "https://checkout-test.adyen.link/abc" };
    const link = await adapter.createPaymentLink({
      amountMinor: 89_50,
      currency: "EUR",
      description: "Invoice INV-2",
      reference: "inv-2",
      returnUrl: "https://shop.example.test/portal",
    });

    expect(fetchCalls[0]).toBe("https://checkout-test.adyen.com/checkout/v71/paymentLinks");
    const body = JSON.parse(fetchCalls[1]!);
    expect(body).toMatchObject({
      reference: "inv-2",
      amount: { value: 8950, currency: "EUR" },
      merchantAccount: "ShopECOM",
    });
    expect(link).toEqual({ url: "https://checkout-test.adyen.link/abc", providerRef: "PL123" });
  });
});

describe("mollie payments adapter", () => {
  const adapter = new MolliePaymentsAdapter(
    { apiKey: "live_test" },
    { webhookUrl: "https://shop.example.test/hook" },
  );

  it("creates a hosted payment with the invoice reference in metadata", async () => {
    fetchResult = {
      id: "tr_abc123",
      _links: { checkout: { href: "https://checkout.mollie.com/xyz" } },
    };
    const link = await adapter.createPaymentLink({
      amountMinor: 60_00,
      currency: "EUR",
      description: "Invoice INV-3",
      reference: "inv-3",
      returnUrl: "https://shop.example.test/portal",
    });

    expect(fetchCalls[0]).toBe("https://api.mollie.com/v2/payments");
    const body = JSON.parse(fetchCalls[1]!);
    expect(body.amount).toEqual({ currency: "EUR", value: "60.00" });
    expect(body.metadata).toEqual({ reference: "inv-3" });
    expect(body.redirectUrl).toBe("https://shop.example.test/portal");
    expect(body.webhookUrl).toBe("https://shop.example.test/hook");
    expect(link).toEqual({ url: "https://checkout.mollie.com/xyz", providerRef: "tr_abc123" });
  });
});

describe("payments adapter definitions", () => {
  it("registers four live adapters and marks the rest as planned slots", () => {
    const live = PAYMENTS_ADAPTER_DEFINITIONS.filter((d) => d.status === "live").map((d) => d.key);
    const planned = PAYMENTS_ADAPTER_DEFINITIONS.filter((d) => d.status === "planned").map(
      (d) => d.key,
    );
    expect(live).toEqual(["stripe", "square", "adyen", "mollie"]);
    // Slots the landscape demands: wallets, the automotive vertical's
    // incumbents, and the regional defaults.
    expect(planned).toEqual([
      "paypal",
      "heartland",
      "worldpay",
      "chase",
      "authorizenet",
      "gocardless",
      "elavon",
      "moneris",
      "razorpay",
      "mercadopago",
      "clover",
    ]);

    const square = getPaymentsAdapterDefinition("square");
    expect(square?.configFields[0]).toMatchObject({ name: "locationId", required: true });
    const adyen = getPaymentsAdapterDefinition("adyen");
    expect(adyen?.configFields[0]).toMatchObject({ name: "merchantAccount", required: true });
  });

  it("instantiates from config + secrets and refuses incomplete or unknown adapters", () => {
    expect(instantiatePaymentsAdapter("stripe", {}, { secretKey: "sk" })).toBeInstanceOf(
      StripePaymentsAdapter,
    );
    expect(
      instantiatePaymentsAdapter("square", { locationId: "L1" }, { accessToken: "EAAA" }),
    ).toBeInstanceOf(SquarePaymentsAdapter);
    expect(
      instantiatePaymentsAdapter("adyen", { merchantAccount: "M" }, { apiKey: "AQEy" }),
    ).toBeInstanceOf(AdyenPaymentsAdapter);
    expect(instantiatePaymentsAdapter("mollie", {}, { apiKey: "live_" })).toBeInstanceOf(
      MolliePaymentsAdapter,
    );

    // Missing config or credentials → null, never a half-configured adapter.
    expect(instantiatePaymentsAdapter("square", {}, { accessToken: "EAAA" })).toBeNull();
    expect(instantiatePaymentsAdapter("square", { locationId: "L1" }, {})).toBeNull();
    expect(instantiatePaymentsAdapter("adyen", {}, { apiKey: "AQEy" })).toBeNull();
    expect(instantiatePaymentsAdapter("stripe", {}, {})).toBeNull();
    // Planned slots cannot instantiate.
    expect(instantiatePaymentsAdapter("chase", {}, { apiKey: "x" })).toBeNull();
    expect(instantiatePaymentsAdapter("paypal", {}, {})).toBeNull();
  });
});
