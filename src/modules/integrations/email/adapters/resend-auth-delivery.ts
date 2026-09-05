import type {
  AuthDeliveryMessage,
  AuthDeliveryProvider,
} from "@/modules/identity/delivery/auth-delivery-provider";
import type { GenericEmailSender } from "@/modules/integrations/email/generic-email-sender";
import { providerErrorDetail } from "@/modules/integrations/email/adapters/http-email-adapter";
import type { ResendConfiguration, ResendSecret } from "./adapter-types";

/**
 * Resend adapter implementing the pre-tenant AuthDeliveryProvider interface.
 *
 * Uses the Resend REST API via fetch (no SDK dependency). The auth send is
 * fire-and-forget per the interface contract; `sendRaw` is awaited and
 * rejects on failure for transactional email with retry semantics.
 */
export class ResendAuthDeliveryProvider implements AuthDeliveryProvider, GenericEmailSender {
  readonly key = "resend";

  constructor(
    private readonly config: ResendConfiguration,
    private readonly secret: ResendSecret,
  ) {}

  send(message: AuthDeliveryMessage): void {
    void this.sendRaw({
      organizationId: "",
      to: message.to,
      subject: buildSubject(message),
      text: buildTextBody(message),
    }).catch(() => undefined);
  }

  async sendRaw(
    input: Readonly<{ organizationId: string; to: string; subject: string; text: string }>,
  ): Promise<void> {
    // organizationId is attribution metadata; transports ignore it.
    const from = this.config.fromName
      ? `${this.config.fromName} <${this.config.fromAddress}>`
      : this.config.fromAddress;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `email adapter resend failed with status ${res.status}${await providerErrorDetail(res)}`,
      );
    }
  }

  async verify(): Promise<boolean> {
    try {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${this.secret.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

function buildSubject(message: AuthDeliveryMessage): string {
  switch (message.kind) {
    case "verification-email":
      return "Verify your email address";
    case "password-reset-email":
      return "Reset your password";
    case "magic-link-email":
      return "Sign in to ShopOS";
    case "email-otp":
      return "Your sign-in code";
    case "two-factor-otp":
      return "Your verification code";
    default:
      return "ShopOS";
  }
}

function buildTextBody(message: AuthDeliveryMessage): string {
  const m = message as { url?: string; otp?: string };
  if (m.url) {
    return `Click the link to continue: ${m.url}`;
  }
  if (m.otp) {
    return `Your code is: ${m.otp}`;
  }
  return "Open ShopOS to continue.";
}
