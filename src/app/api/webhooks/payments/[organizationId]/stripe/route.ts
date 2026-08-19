import { db } from "@/db/client";
import { recordStripeCheckoutCompleted } from "@/modules/billing/processor-payment-service";
import { verifyStripeWebhook } from "@/modules/integrations/payments/payments-adapters";
import { resolveOrgPaymentsSecrets } from "@/modules/integrations/payments/payments-connector-service";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook endpoint. The organization is resolved from the URL path —
 * never from the payload — and the signature is verified against that
 * organization's stored signing secret before anything in the body is
 * trusted. Unsigned, stale, or tampered requests fail closed with 400.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  const rawBody = await request.text();
  const { organizationId } = await context.params;

  const secrets = await resolveOrgPaymentsSecrets(db, organizationId);
  if (!secrets || secrets.adapterKey !== "stripe") {
    return Response.json({ error: "no_processor" }, { status: 400 });
  }

  const event = verifyStripeWebhook({
    signingSecret: secrets.secret.webhookSigningSecret,
    signatureHeader: request.headers.get("stripe-signature"),
    rawBody,
  });
  if (!event) {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  const typed = event as { type?: string; id?: string };
  if (typed.type !== "checkout.session.completed" || !typed.id) {
    // Acknowledge unhandled event types so Stripe stops retrying.
    return Response.json({ received: true, handled: false });
  }

  const outcome = await recordStripeCheckoutCompleted(db, organizationId, {
    id: typed.id,
    ...(event as object),
  } as Parameters<typeof recordStripeCheckoutCompleted>[2]);

  return Response.json({ received: true, outcome: outcome.kind });
}
