import { db } from "@/db/client";
import { recordInboundSms } from "@/modules/integrations/sms/sms-service";

export const dynamic = "force-dynamic";

/**
 * Public inbound-SMS webhook (Twilio form-post). Requests are verified with
 * the provider's signature against the org's configured adapter; unverified
 * requests are rejected. The organization is resolved by matching the
 * recipient (the shop's configured from-number) to its active connector.
 */
export async function POST(request: Request): Promise<Response> {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const from = form.get("From");
  const to = form.get("To");
  const body = form.get("Body");
  const providerMessageId = form.get("MessageSid");
  if (!from || !to || !body) {
    return new Response("Bad Request", { status: 400 });
  }

  // Resolve the organization by the receiving number on its active connector.
  const connectors = await db.connectorInstance.findMany({
    where: { capability: "sms_delivery", status: "active" },
    select: {
      id: true,
      organizationId: true,
      adapterKey: true,
      configuration: true,
      encryptedSecret: true,
      scope: true,
    },
  });

  const { decryptSecret, getMasterKeyFromEnv } =
    await import("@/modules/integrations/crypto/secret-cipher");
  const masterKey = getMasterKeyFromEnv();

  for (const connector of connectors) {
    if (connector.scope !== "organization" || !connector.organizationId) continue;
    const config = (connector.configuration ?? {}) as Record<string, unknown>;
    if (String(config.fromNumber ?? "") !== to) continue;
    if (connector.adapterKey !== "twilio" || !masterKey || !connector.encryptedSecret) continue;

    let secret: { authToken: string };
    try {
      secret = JSON.parse(decryptSecret(connector.encryptedSecret, masterKey));
    } catch {
      continue;
    }

    const { TwilioSmsAdapter } = await import("@/modules/integrations/sms/sms-adapters");
    const adapter = new TwilioSmsAdapter(
      { accountSid: String(config.accountSid ?? ""), fromNumber: to },
      { authToken: secret.authToken },
    );
    if (!adapter.verifyInbound(request, form)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      await recordInboundSms(db, {
        organizationId: connector.organizationId,
        from,
        body,
        ...(providerMessageId ? { providerMessageId } : {}),
      });
      // Twilio expects TwiML; an empty response acks the message.
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    } catch {
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // No org connector matched the receiving number.
  return new Response("Not Found", { status: 404 });
}
