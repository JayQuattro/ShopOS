import type {
  AuthDeliveryMessage,
  AuthDeliveryProvider,
} from "@/modules/identity/delivery/auth-delivery-provider";

/**
 * Shared HTTP-based email adapter base class.
 *
 * Most email APIs follow the same pattern: POST to an endpoint with an auth
 * header and a JSON body containing from/to/subject/content. This base class
 * handles the fire-and-forget send and error swallowing, letting each adapter
 * only define its endpoint, auth, and body format.
 */
export abstract class HttpEmailAdapter implements AuthDeliveryProvider {
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
    const from = this.buildFrom(this.getFromAddress(), this.getFromName());

    void fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.buildHeaders(),
      },
      body: JSON.stringify(this.buildBody(from, message.to, subject, text)),
    })
      .then(() => undefined)
      .catch(() => undefined);
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
