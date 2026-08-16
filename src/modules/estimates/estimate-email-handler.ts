import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import type { EventHandler, EventHandlerInput } from "@/modules/outbox/event-handler";
import { getAuthConfig } from "@/modules/identity/config";
import { sendTransactionalEmail } from "@/modules/integrations/email/transactional-email";

export const ESTIMATE_PRESENTED_EVENT = "estimate.presented";

/** Default locale for customer email until per-customer locale preferences land (#60). */
const EMAIL_LOCALE = "en";
const EMAIL_TIME_ZONE = "UTC";

/** Lifetime of authorization links issued by presentRevision. */
export const AUTHORIZATION_LINK_TTL_HOURS = 72;

/**
 * Builds the customer-facing authorization email. Pure and unit-tested:
 * totals are formatted from the revision's own currency, and the only place
 * the token appears is the authorize URL.
 */
export function buildEstimateAuthorizationEmail(
  input: Readonly<{
    organizationName: string;
    workOrderNumber: string;
    revisionNumber: number;
    totalMinor: string;
    currency: string;
    authorizeUrl: string;
    expiresAt: Date;
  }>,
): Readonly<{ subject: string; text: string }> {
  const total = formatMoney(Number(input.totalMinor), input.currency, EMAIL_LOCALE);
  // Component-based options (not dateStyle) because formatDate merges its own
  // year/month/day defaults, which Intl rejects alongside dateStyle.
  const expiry = formatDate(input.expiresAt, EMAIL_TIME_ZONE, EMAIL_LOCALE, {
    weekday: "long",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  return {
    subject: `Estimate ready for ${input.workOrderNumber} — ${input.organizationName}`,
    text: [
      `${input.organizationName} has prepared estimate revision ${input.revisionNumber} for ${input.workOrderNumber}.`,
      "",
      `Estimated total: ${total}`,
      "",
      "Open the secure link below to review the details and approve or decline the work:",
      input.authorizeUrl,
      "",
      `This link expires ${expiry} (UTC) and can only be used once.`,
      "If you did not expect this email, you can ignore it.",
    ].join("\n"),
  };
}

/**
 * Sends the customer their authorization email when an estimate revision is
 * presented. Registered on the outbox dispatcher; the dispatcher has already
 * revalidated the organization context before this handler runs.
 */
export class EstimatePresentedEmailHandler implements EventHandler {
  readonly eventType = ESTIMATE_PRESENTED_EVENT;

  constructor(private readonly db: PrismaClient) {}

  async handle(input: EventHandlerInput): Promise<void> {
    const revisionId = readString(input.event.data, "revisionId");
    const workOrderId = readString(input.event.data, "workOrderId");
    const locationId = readString(input.event.data, "locationId");
    if (!revisionId || !workOrderId || !locationId) {
      // Malformed payload — permanent failure; let the dispatcher dead-letter it.
      throw new Error("estimate.presented payload missing required fields");
    }
    const organizationId = input.event.organizationId;

    const revision = await this.db.estimateRevision.findFirst({
      where: { id: revisionId, organizationId },
      select: {
        revisionNumber: true,
        currency: true,
        totalMinor: true,
        workOrder: {
          select: {
            id: true,
            number: true,
            customerId: true,
            customer: {
              select: {
                primaryEmail: true,
                contacts: {
                  where: { email: { not: null } },
                  orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
                  take: 1,
                  select: { email: true },
                },
              },
            },
          },
        },
        organization: { select: { name: true } },
      },
    });
    if (!revision) throw new Error("estimate revision not found for notification");

    const recipient =
      revision.workOrder.customer.contacts[0]?.email ??
      revision.workOrder.customer.primaryEmail ??
      null;
    if (!recipient) {
      // No contact email on file — a permanent condition. Record it and
      // complete the event so the queue is not blocked by retries that can
      // never succeed.
      await this.recordActivity({
        organizationId,
        locationId,
        workOrderId,
        eventType: "estimate.email_skipped",
        summary: "Authorization email not sent: no contact email on file for the customer.",
      });
      return;
    }

    const link = await this.db.authorizationLink.findFirst({
      where: {
        organizationId,
        estimateRevisionId: revisionId,
        revokedAt: null,
        usedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: { token: true, expiresAt: true },
    });
    if (!link) throw new Error("no active authorization link for presented revision");

    const authorizeUrl = `${getAuthConfig().baseURL}/authorize/${link.token}`;
    const email = buildEstimateAuthorizationEmail({
      organizationName: revision.organization.name,
      workOrderNumber: revision.workOrder.number,
      revisionNumber: revision.revisionNumber,
      totalMinor: revision.totalMinor.toString(),
      currency: revision.currency,
      authorizeUrl,
      expiresAt: link.expiresAt,
    });

    const outcome = await sendTransactionalEmail({
      db: this.db,
      organizationId,
      to: recipient,
      subject: email.subject,
      text: email.text,
    });

    // The URL (and therefore token) must never appear in activity summaries.
    await this.recordActivity({
      organizationId,
      locationId,
      workOrderId,
      eventType: outcome.delivered ? "estimate.email_sent" : "estimate.email_unavailable",
      summary: outcome.delivered
        ? `Authorization email sent to the customer for revision ${revision.revisionNumber}.`
        : `Email connector not configured; authorization link for revision ${revision.revisionNumber} was not emailed. Re-send after configuring email.`,
    });
  }

  private async recordActivity(
    input: Readonly<{
      organizationId: string;
      locationId: string;
      workOrderId: string;
      eventType: string;
      summary: string;
    }>,
  ): Promise<void> {
    await this.db.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        locationId: input.locationId,
        workOrderId: input.workOrderId,
        eventType: input.eventType,
        summary: input.summary,
      },
    });
  }
}

function readString(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
