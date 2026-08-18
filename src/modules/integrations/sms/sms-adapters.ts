import { createHmac } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";

/**
 * SMS adapter boundary (ADR 0008). Twilio is the first adapter; the
 * capability is `sms_delivery` on the connector framework, org-scoped first
 * then platform, same resolution order as email.
 */
export interface SmsDeliveryAdapter {
  readonly key: string;
  send(
    input: Readonly<{ to: string; body: string }>,
  ): Promise<Readonly<{ providerMessageId?: string }>>;
  /** Verifies an inbound webhook signature; returns the sender number and body. */
  verifyInbound(request: Request, form: URLSearchParams): boolean;
}

export class TwilioSmsAdapter implements SmsDeliveryAdapter {
  readonly key = "twilio";

  constructor(
    private readonly config: Readonly<{
      accountSid: string;
      fromNumber: string;
      apiBaseUrl?: string;
    }>,
    private readonly secret: Readonly<{ authToken: string }>,
  ) {}

  async send(
    input: Readonly<{ to: string; body: string }>,
  ): Promise<Readonly<{ providerMessageId?: string }>> {
    const url = `${this.config.apiBaseUrl ?? "https://api.twilio.com"}/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
    const params = new URLSearchParams({
      To: input.to,
      From: this.config.fromNumber,
      Body: input.body,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.secret.authToken}`).toString("base64")}`,
      },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(`twilio send failed with status ${res.status}`);
    }
    const data = (await res.json()) as { sid?: string };
    return data.sid ? { providerMessageId: data.sid } : {};
  }

  /**
   * Twilio signs webhooks with X-Twilio-Signature: HMAC-SHA1 of the URL +
   * sorted form params, base64, using the auth token.
   */
  verifyInbound(request: Request, form: URLSearchParams): boolean {
    const signature = request.headers.get("x-twilio-signature");
    if (!signature) return false;
    const url = request.url;
    const sorted = [...form.entries()].sort(([a], [b]) => a.localeCompare(b));
    const data = sorted.reduce((acc, [key, value]) => acc + key + value, url);
    const expected = createHmac("sha1", this.secret.authToken)
      .update(Buffer.from(data, "utf-8"))
      .digest("base64");
    return expected === signature;
  }
}

/** Console adapter for dev/test: captures instead of sending. */
export class ConsoleSmsAdapter implements SmsDeliveryAdapter {
  readonly key = "console";
  readonly sent: Array<Readonly<{ to: string; body: string }>> = [];

  async send(
    input: Readonly<{ to: string; body: string }>,
  ): Promise<Readonly<{ providerMessageId?: string }>> {
    // Body intentionally not logged in production.
    this.sent.push({ to: input.to, body: input.body });
    if (process.env.NODE_ENV !== "test") {
      console.info(`[sms] -> ${input.to}: ${input.body.slice(0, 40)}…`);
    }
    return { providerMessageId: `console-${this.sent.length}` };
  }

  verifyInbound(): boolean {
    return true;
  }
}

let consoleSingleton: ConsoleSmsAdapter | undefined;

export function getConsoleSmsAdapter(): ConsoleSmsAdapter {
  if (!consoleSingleton) consoleSingleton = new ConsoleSmsAdapter();
  return consoleSingleton;
}

/** Resolves the org's SMS adapter: org connector → platform connector → dev console → null. */
export async function resolveSmsAdapter(
  db: PrismaClient,
  organizationId: string,
): Promise<SmsDeliveryAdapter | null> {
  if (process.env.NODE_ENV === "test") {
    return getConsoleSmsAdapter();
  }
  const { decryptSecret, getMasterKeyFromEnv } =
    await import("@/modules/integrations/crypto/secret-cipher");
  const connector =
    (await db.connectorInstance.findFirst({
      where: { organizationId, capability: "sms_delivery", status: "active" },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    })) ??
    (await db.connectorInstance.findFirst({
      where: { scope: "platform", capability: "sms_delivery", status: "active" },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    }));
  if (!connector) {
    if (process.env.NODE_ENV !== "production") return getConsoleSmsAdapter();
    return null;
  }

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey || !connector.encryptedSecret) return null;
  let secret: { authToken: string };
  try {
    secret = JSON.parse(decryptSecret(connector.encryptedSecret, masterKey));
  } catch {
    return null;
  }

  const config = (connector.configuration ?? {}) as Record<string, unknown>;
  if (connector.adapterKey === "twilio") {
    if (!secret.authToken || !config.accountSid || !config.fromNumber) return null;
    return new TwilioSmsAdapter(
      {
        accountSid: String(config.accountSid),
        fromNumber: String(config.fromNumber),
      },
      { authToken: secret.authToken },
    );
  }
  return null;
}
