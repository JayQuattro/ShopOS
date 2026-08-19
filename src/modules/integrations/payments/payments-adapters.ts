import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Payments connector boundary (ADR 0016): BYO, organization-scoped processor
 * adapters. v1 surface is hosted payment links plus signed webhook
 * verification. Amounts are always integer minor units plus an ISO currency
 * code.
 */
export type PaymentLinkInput = Readonly<{
  amountMinor: number;
  currency: string;
  description: string;
  /** Invoice-side reference the provider echoes back in webhooks. */
  reference: string;
  returnUrl: string;
}>;

export type PaymentLink = Readonly<{
  url: string;
  providerRef: string;
}>;

export interface PaymentsAdapter {
  readonly key: string;
  createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink>;
  /** Returns money through the processor; adapters without refund support omit it. */
  createRefund?(
    input: Readonly<{ chargeId: string; amountMinor: number }>,
  ): Promise<Readonly<{ refundId: string }>>;
}

/** Dev/test adapter: deterministic fake link, never a live charge. */
export class ConsolePaymentsAdapter implements PaymentsAdapter {
  readonly key = "console";

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
    const providerRef = `console_${input.reference}_${input.amountMinor}`;
    return {
      url: `https://pay.shopos.test/demo/${encodeURIComponent(providerRef)}`,
      providerRef,
    };
  }
}

let consoleSingleton: ConsolePaymentsAdapter | undefined;

export function getConsolePaymentsAdapter(): ConsolePaymentsAdapter {
  if (!consoleSingleton) consoleSingleton = new ConsolePaymentsAdapter();
  return consoleSingleton;
}

// ─── Stripe ─────────────────────────────────────────────────────────────────

/**
 * Stripe adapter using Checkout Sessions in payment mode: a hosted link the
 * customer pays at, with Apple Pay / Google Pay / Alipay / WeChat Pay riding
 * the shop's own Stripe configuration. The session id comes back in
 * `checkout.session.completed` webhooks as `client_reference_id`.
 */
export class StripePaymentsAdapter implements PaymentsAdapter {
  readonly key = "stripe";

  constructor(private readonly secret: Readonly<{ secretKey: string }>) {}

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(input.amountMinor),
      "line_items[0][price_data][product_data][name]": input.description.slice(0, 200),
      client_reference_id: input.reference,
      success_url: input.returnUrl,
      cancel_url: input.returnUrl,
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`stripe_create_payment_link_failed_${res.status}`);

    const session = (await res.json()) as { id: string; url: string | null };
    if (!session.url) throw new Error("stripe_payment_link_missing_url");

    return { url: session.url, providerRef: session.id };
  }

  async createRefund(input: Readonly<{ chargeId: string; amountMinor: number }>) {
    const body = new URLSearchParams({
      payment_intent: input.chargeId,
      amount: String(input.amountMinor),
    });
    const res = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`stripe_create_refund_failed_${res.status}`);
    const refund = (await res.json()) as { id: string };
    return { refundId: refund.id };
  }
}

// ─── Stripe webhook verification ────────────────────────────────────────────

/**
 * Verifies a Stripe webhook signature header against the raw request body:
 * `t=<unix>,v1=<hex>` where v1 = HMAC-SHA256(webhookSecret, `${t}.${body}`).
 * Returns the parsed event, or null for any tampering, staleness beyond the
 * tolerance, or a missing signing secret — webhooks fail closed.
 */
export function verifyStripeWebhook(input: {
  signingSecret: string | undefined;
  signatureHeader: string | null;
  rawBody: string;
  toleranceSeconds?: number;
}): unknown | null {
  const { signingSecret, signatureHeader, rawBody } = input;
  if (!signingSecret || !signatureHeader) return null;

  const parts = new Map<string, string>();
  for (const element of signatureHeader.split(",")) {
    const [key, value] = element.split("=");
    if (key && value) parts.set(key.trim(), value.trim());
  }
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return null;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > (input.toleranceSeconds ?? 300)) return null;

  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

// ─── Square ─────────────────────────────────────────────────────────────────

/**
 * Square (Block) — the default processor for brick-and-mortar small
 * businesses. Online-checkout payment links: a quick-pay order Square hosts
 * at a shareable URL. Square-Version pinned per the API stability policy.
 */
export class SquarePaymentsAdapter implements PaymentsAdapter {
  readonly key = "square";

  constructor(
    private readonly config: Readonly<{ locationId: string }>,
    private readonly secret: Readonly<{ accessToken: string }>,
  ) {}

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
    const body = {
      idempotency_key: `${input.reference}-${input.amountMinor}`,
      description: input.description.slice(0, 60),
      order: {
        location_id: this.config.locationId,
        line_items: [
          {
            name: input.description.slice(0, 120),
            quantity: "1",
            base_price_money: {
              amount: input.amountMinor,
              currency: input.currency,
            },
          },
        ],
      },
    };

    const res = await fetch("https://connect.squareup.com/v2/online-checkout/payment-links", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret.accessToken}`,
        "Square-Version": "2026-01-23",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`square_create_payment_link_failed_${res.status}`);

    const payload = (await res.json()) as {
      payment_link?: { id: string; url: string };
    };
    if (!payload.payment_link?.url) throw new Error("square_payment_link_missing_url");

    return { url: payload.payment_link.url, providerRef: payload.payment_link.id };
  }
}

// ─── Adyen ──────────────────────────────────────────────────────────────────

/**
 * Adyen Pay by Link: a hosted page covering cards, wallets, and local
 * methods, created with a reference we control for reconciliation.
 */
export class AdyenPaymentsAdapter implements PaymentsAdapter {
  readonly key = "adyen";

  constructor(
    private readonly secret: Readonly<{ apiKey: string }>,
    private readonly config: Readonly<{ merchantAccount: string }> = { merchantAccount: "" },
  ) {}

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
    const res = await fetch("https://checkout-test.adyen.com/checkout/v71/paymentLinks", {
      method: "POST",
      headers: {
        "X-API-Key": this.secret.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reference: input.reference,
        amount: { value: input.amountMinor, currency: input.currency },
        description: input.description.slice(0, 120),
        merchantAccount: this.config.merchantAccount,
      }),
    });
    if (!res.ok) throw new Error(`adyen_create_payment_link_failed_${res.status}`);

    const payload = (await res.json()) as { id: string; url: string };
    if (!payload.url) throw new Error("adyen_payment_link_missing_url");

    return { url: payload.url, providerRef: payload.id };
  }
}

// ─── Mollie ─────────────────────────────────────────────────────────────────

/**
 * Mollie — the EU default. Creates a hosted payment carrying our invoice
 * reference in metadata; the checkout URL is the shareable link.
 */
export class MolliePaymentsAdapter implements PaymentsAdapter {
  readonly key = "mollie";

  constructor(
    private readonly secret: Readonly<{ apiKey: string }>,
    private readonly config: Readonly<{ webhookUrl?: string }> = {},
  ) {}

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
    const res = await fetch("https://api.mollie.com/v2/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: {
          currency: input.currency,
          value: (input.amountMinor / 100).toFixed(2),
        },
        description: input.description.slice(0, 120),
        redirectUrl: input.returnUrl,
        metadata: { reference: input.reference },
        ...(this.config.webhookUrl ? { webhookUrl: this.config.webhookUrl } : {}),
      }),
    });
    if (!res.ok) throw new Error(`mollie_create_payment_link_failed_${res.status}`);

    const payload = (await res.json()) as {
      id: string;
      _links?: { checkout?: { href: string } };
    };
    const url = payload._links?.checkout?.href;
    if (!url) throw new Error("mollie_payment_link_missing_url");

    return { url, providerRef: payload.id };
  }
}

// ─── Mercado Pago ───────────────────────────────────────────────────────────

/**
 * Zero-decimal currencies (minor unit == major unit); everything else
 * ShopOS bills in has two. Latin American processors mix both.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(["CLP", "COP", "PYG", "UYW", "GNF", "JPY", "KRW"]);

function majorAmountString(amountMinor: number, currency: string): string {
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return String(amountMinor);
  return (amountMinor / 100).toFixed(2);
}

/**
 * Mercado Pago Checkout Pro — the LatAm default (AR, BR, CL, CO, MX, PE,
 * UY). Preferences carry our invoice reference back in
 * `external_reference`; amounts are major-unit floats, decimal-aware for
 * zero-decimal currencies like CLP and COP.
 */
export class MercadoPagoPaymentsAdapter implements PaymentsAdapter {
  readonly key = "mercadopago";

  constructor(private readonly secret: Readonly<{ accessToken: string }>) {}

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            title: input.description.slice(0, 120),
            quantity: 1,
            unit_price: Number(majorAmountString(input.amountMinor, input.currency)),
            currency_id: input.currency,
          },
        ],
        external_reference: input.reference,
      }),
    });
    if (!res.ok) throw new Error(`mercadopago_create_payment_link_failed_${res.status}`);

    const payload = (await res.json()) as { id: string; init_point?: string };
    if (!payload.init_point) throw new Error("mercadopago_payment_link_missing_url");

    return { url: payload.init_point, providerRef: payload.id };
  }
}

// ─── Razorpay ───────────────────────────────────────────────────────────────

/**
 * Razorpay Payment Links — India's default (cards, UPI, netbanking,
 * wallets). Amounts are integer paise; Basic auth with the key pair.
 */
export class RazorpayPaymentsAdapter implements PaymentsAdapter {
  readonly key = "razorpay";

  constructor(private readonly secret: Readonly<{ keyId: string; keySecret: string }>) {}

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
    const auth = Buffer.from(`${this.secret.keyId}:${this.secret.keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        description: input.description.slice(0, 120),
        // Razorpay caps reference_id at 40 characters; our invoice UUID fits.
        reference_id: input.reference.slice(0, 40),
        callback_url: input.returnUrl,
        callback_method: "get",
      }),
    });
    if (!res.ok) throw new Error(`razorpay_create_payment_link_failed_${res.status}`);

    const payload = (await res.json()) as { id: string; short_url: string };
    if (!payload.short_url) throw new Error("razorpay_payment_link_missing_url");

    return { url: payload.short_url, providerRef: payload.id };
  }
}

/**
 * Razorpay webhook verification: X-Razorpay-Signature is hex
 * HMAC-SHA256(webhook_secret, raw_body) with no timestamp — replay
 * tolerance comes from idempotent recording, not freshness.
 */
export function verifyRazorpayWebhook(input: {
  webhookSecret: string | undefined;
  signatureHeader: string | null;
  rawBody: string;
}): unknown | null {
  const { webhookSecret, signatureHeader, rawBody } = input;
  if (!webhookSecret || !signatureHeader) return null;

  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}
