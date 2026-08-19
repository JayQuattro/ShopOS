/**
 * Payments connector boundary (ADR 0016): BYO, organization-scoped processor
 * adapters. v1 surface is hosted payment links; signed webhook verification
 * joins in the adapter that needs it. Amounts are always integer minor units
 * plus an ISO currency code.
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
}
