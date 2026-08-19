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
