import nodemailer from "nodemailer";

import type {
  AuthDeliveryMessage,
  AuthDeliveryProvider,
} from "@/modules/identity/delivery/auth-delivery-provider";
import type { SmtpConfiguration, SmtpSecret } from "./adapter-types";

/**
 * SMTP adapter implementing the pre-tenant AuthDeliveryProvider interface.
 *
 * Sends auth emails (verification, password reset, magic link, OTPs) through
 * any SMTP server. The send is fire-and-forget per the interface contract —
 * errors are caught internally so recovery endpoints never crash.
 */
export class SmtpAuthDeliveryProvider implements AuthDeliveryProvider {
  readonly key = "smtp";
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly config: SmtpConfiguration,
    secret: SmtpSecret,
  ) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: secret.username,
        pass: secret.password,
      },
    });
  }

  send(message: AuthDeliveryMessage): void {
    const subject = buildSubject(message);
    const text = buildTextBody(message);
    const from = this.config.fromName
      ? `${this.config.fromName} <${this.config.fromAddress}>`
      : this.config.fromAddress;

    void this.transporter
      .sendMail({
        from,
        to: message.to,
        subject,
        text,
      })
      .catch(() => undefined);
  }

  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
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
