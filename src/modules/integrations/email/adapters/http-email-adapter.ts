import type {
  AuthDeliveryMessage,
  AuthDeliveryProvider,
} from "@/modules/identity/delivery/auth-delivery-provider";
import type { GenericEmailSender } from "@/modules/integrations/email/generic-email-sender";

/**
 * Shared HTTP-based email adapter base class.
 *
 * Most email APIs follow the same pattern: POST to an endpoint with an auth
 * header and a JSON body containing from/to/subject/content. This base class
 * handles the send and lets each adapter only define its endpoint, auth, and
 * body format.
 *
 * Two send paths share the transport: `send` (fire-and-forget, for pre-tenant
 * auth messages per ADR 0011) and `sendRaw` (awaited, rejects on failure, for
 * tenant-facing transactional email with retry semantics).
 */
export abstract class HttpEmailAdapter implements AuthDeliveryProvider, GenericEmailSender {
  abstract readonly key: string;

  protected abstract readonly endpoint: string;
  protected abstract readonly verifyEndpoint: string;

  /**
   * Builds the HTTP headers for the API request (auth, content-type).
   * Subclasses override this to provide their provider's auth mechanism.
   */
  protected abstract buildHeaders(): Record<string, string>;

  /**
   * Builds the provider-specific JSON body for the email send request.
   */
  protected abstract buildBody(
    from: string,
    to: string,
    subject: string,
    text: string,
  ): Record<string, unknown>;

  /**
   * Builds the "from" display string from config.
   */
  protected buildFrom(fromAddress: string, fromName?: string): string {
    return fromName ? `${fromName} <${fromAddress}>` : fromAddress;
  }

  send(message: AuthDeliveryMessage): void {
    const subject = buildSubject(message);
    const text = buildTextBody(message);
    void this.sendRaw({ organizationId: "", to: message.to, subject, text }).catch(() => undefined);
  }

  async sendRaw(
    input: Readonly<{ organizationId: string; to: string; subject: string; text: string }>,
  ): Promise<void> {
    // organizationId is attribution metadata; transports ignore it.
    const from = this.buildFrom(this.getFromAddress(), this.getFromName());
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.buildHeaders(),
      },
      body: JSON.stringify(this.buildBody(from, input.to, input.subject, input.text)),
    });
    if (!res.ok) {
      throw new Error(
        `email adapter ${this.key} failed with status ${res.status}${await providerErrorDetail(res)}`,
      );
    }
  }

  async verify(): Promise<boolean> {
    try {
      const res = await fetch(this.verifyEndpoint, {
        headers: this.buildHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  protected abstract getFromAddress(): string;
  protected abstract getFromName(): string | undefined;
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
  if (m.url) return `Click the link to continue: ${m.url}`;
  if (m.otp) return `Your code is: ${m.otp}`;
  return "Open ShopOS to continue.";
}

/**
 * Extracts a human-readable reason from a provider's error response body so
 * connector test sends can show why the provider rejected the message (e.g.
 * ZeptoMail's "from address not allowed", SendGrid's field errors). Returns ""
 * when nothing useful can be read — the status code alone is still reported.
 */
export async function providerErrorDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const text = extractErrorText(body);
    return text ? `: ${text.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}

function extractErrorText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractErrorText(item);
      if (text) return text;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "detail", "error", "errors", "errorMessage", "title"]) {
      if (key in record) {
        const text = extractErrorText(record[key]);
        if (text) return text;
      }
    }
  }
  return null;
}
