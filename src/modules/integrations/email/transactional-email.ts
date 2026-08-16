import type { PrismaClient } from "@/generated/prisma/client";
import type { GenericEmailSender } from "@/modules/integrations/email/generic-email-sender";

const CAPTURE_LIMIT = 64;

export type CapturedTransactionalEmail = Readonly<{
  organizationId: string;
  to: string;
  subject: string;
  recordedAt: string;
}>;

/**
 * Deterministic dev/test sender for tenant-facing transactional email.
 *
 * Captures a record per send so integration tests can assert that business
 * email (estimate notifications, receipts) was produced without touching a
 * real inbox. In development it logs the same summary. Message bodies are
 * never retained or logged.
 */
export class ConsoleEmailSender implements GenericEmailSender {
  readonly key = "console";
  private readonly captured: CapturedTransactionalEmail[] = [];

  async sendRaw(
    input: Readonly<{ organizationId: string; to: string; subject: string; text: string }>,
  ): Promise<void> {
    // The body is intentionally neither captured nor logged.
    this.captured.push({
      organizationId: input.organizationId,
      to: input.to,
      subject: input.subject,
      recordedAt: new Date().toISOString(),
    });
    if (this.captured.length > CAPTURE_LIMIT) {
      this.captured.shift();
    }
    if (process.env.NODE_ENV !== "test") {
      console.info(`[email] transactional -> ${input.to} "${input.subject}"`);
    }
  }

  sentEmails(): ReadonlyArray<CapturedTransactionalEmail> {
    return [...this.captured];
  }

  reset(): void {
    this.captured.length = 0;
  }
}

let consoleSingleton: ConsoleEmailSender | undefined;

export function getConsoleEmailSender(): ConsoleEmailSender {
  if (!consoleSingleton) {
    consoleSingleton = new ConsoleEmailSender();
  }
  return consoleSingleton;
}

/**
 * Resolves the tenant-facing email sender for an organization.
 *
 * Resolution order (ADR 0008): active org-scoped email connector → active
 * platform-scoped connector → dev/test console fallback. In production with no
 * connector configured there is no fail-open: callers receive null and must
 * surface the undelivered state rather than dropping the message silently.
 *
 * Resolved per send (no process-wide cache) because the active connector can
 * differ per organization.
 */
export async function resolveTransactionalEmailSender(
  db: PrismaClient,
  organizationId: string,
): Promise<GenericEmailSender | null> {
  if (process.env.NODE_ENV === "test") {
    return getConsoleEmailSender();
  }

  const connector =
    (await db.connectorInstance.findFirst({
      where: { organizationId, capability: "email_delivery", status: "active" },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    })) ??
    (await db.connectorInstance.findFirst({
      where: { scope: "platform", capability: "email_delivery", status: "active" },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    }));

  if (connector) {
    const { instantiateAdapter } =
      await import("@/modules/integrations/email/email-delivery-resolver");
    const adapter = instantiateAdapter(
      connector.adapterKey,
      connector.configuration,
      connector.encryptedSecret,
    );
    if (adapter && "sendRaw" in adapter) {
      return adapter as GenericEmailSender;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return getConsoleEmailSender();
  }

  return null;
}

export type TransactionalEmailOutcome = Readonly<{
  /** True when the message was handed to a delivery adapter. */
  delivered: boolean;
}>;

/**
 * Sends a tenant-facing transactional email for the given organization.
 *
 * - Resolved sender delivers → `{ delivered: true }`.
 * - No connector configured (production) → `{ delivered: false }` — callers
 *   surface this state; it is permanent, so callers must NOT retry.
 * - Adapter rejects → the error propagates so retry callers (the outbox)
 *   can reattempt delivery.
 *
 * Callers are responsible for tenant-context revalidation before invoking.
 */
export async function sendTransactionalEmail(
  input: Readonly<{
    db: PrismaClient;
    organizationId: string;
    to: string;
    subject: string;
    text: string;
  }>,
): Promise<TransactionalEmailOutcome> {
  const sender = await resolveTransactionalEmailSender(input.db, input.organizationId);
  if (!sender) {
    return { delivered: false };
  }
  await sender.sendRaw({
    organizationId: input.organizationId,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  return { delivered: true };
}
