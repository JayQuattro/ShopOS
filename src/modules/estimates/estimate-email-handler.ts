import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import type { EventHandler, EventHandlerInput } from "@/modules/outbox/event-handler";
import { getAuthConfig } from "@/modules/identity/config";
import { sendTransactionalEmail } from "@/modules/integrations/email/transactional-email";
import { getAuthorizedTotals } from "@/modules/estimates/change-order-service";
import { sendCustomerSms } from "@/modules/integrations/sms/sms-service";

export const ESTIMATE_PRESENTED_EVENT = "estimate.presented";

/** Default locale for customer email until per-customer locale preferences land (#60). */
const EMAIL_LOCALE = "en";
const EMAIL_TIME_ZONE = "UTC";

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
 * Builds the change-order customer email (ADR 0014). Two variants share the
 * cumulative framing — the delta and the new total are always shown:
 * - awaiting decision: one-time authorize URL and expiry;
 * - auto-applied credit: notification only, no URL.
 *
 * Pure and unit-tested; the token appears only in the authorize URL.
 */
export function buildChangeOrderEmail(
  input: Readonly<{
    organizationName: string;
    workOrderNumber: string;
    changeOrderNumber: number;
    note: string;
    deltaMinor: string;
    currency: string;
    previouslyApprovedMinor: string;
    newTotalMinor: string;
    authorizeUrl: string | null;
    expiresAt: Date | null;
  }>,
): Readonly<{ subject: string; text: string }> {
  const delta = formatSignedMoney(Number(input.deltaMinor), input.currency);
  const previous = formatMoney(Number(input.previouslyApprovedMinor), input.currency, EMAIL_LOCALE);
  const newTotal = formatMoney(Number(input.newTotalMinor), input.currency, EMAIL_LOCALE);

  const isCredit = Number(input.deltaMinor) <= 0;
  const applied = input.authorizeUrl === null;

  const lines = [
    isCredit
      ? `${input.organizationName} adjusted the price for ${input.workOrderNumber}.`
      : `${input.organizationName} found additional work needed on ${input.workOrderNumber} and needs your approval.`,
    "",
    `Change order ${input.changeOrderNumber}: ${input.note}`,
    "",
    `Previously authorized: ${previous}`,
    `This change: ${delta}`,
    `New authorized total: ${newTotal}`,
  ];

  if (applied) {
    lines.push(
      "",
      "Because this change only reduces what you owe, it has been applied automatically — no action is needed.",
    );
  } else {
    lines.push(
      "",
      "Open the secure link below to review the details and approve or decline the additional work:",
      input.authorizeUrl ?? "",
    );
    if (input.expiresAt) {
      lines.push(
        "",
        `This link expires ${formatDate(input.expiresAt, EMAIL_TIME_ZONE, EMAIL_LOCALE, {
          weekday: "long",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })} (UTC) and can only be used once.`,
      );
    }
  }

  lines.push("", "If you did not expect this email, you can ignore it.");

  return {
    subject: applied
      ? `Price adjustment on ${input.workOrderNumber} — ${input.organizationName}`
      : `Additional work needs your approval — ${input.workOrderNumber} (${input.organizationName})`,
    text: lines.join("\n"),
  };
}

/** Formats a possibly-negative minor-unit amount with an explicit sign. */
function formatSignedMoney(amountMinor: number, currency: string): string {
  const magnitude = formatMoney(Math.abs(amountMinor), currency, EMAIL_LOCALE);
  return amountMinor < 0 ? `-${magnitude}` : `+${magnitude}`;
}

/**
 * Sends the customer their authorization email when an estimate revision is
 * presented. Registered on the outbox dispatcher; the dispatcher has already
 * revalidated the organization context before this handler runs. Change orders
 * get the cumulative delta framing of ADR 0014; auto-applied credits notify
 * without a link.
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
        changeOrderNumber: true,
        documentKind: true,
        summaryNote: true,
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
        organization: { select: { name: true, notifyEstimateEmail: true } },
      },
    });
    if (!revision) throw new Error("estimate revision not found for notification");
    if (!revision.organization.notifyEstimateEmail) return; // disabled by settings

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

    // Auto-applied credit change orders carry SYSTEM decisions and no link.
    const autoApplied =
      revision.documentKind === "CHANGE_ORDER" &&
      (await this.db.authorizationDecision.findFirst({
        where: {
          decision: "APPROVED",
          authorization: { method: "SYSTEM", estimateRevisionId: revisionId },
          estimateLine: { estimateRevisionId: revisionId },
        },
        select: { authorizationId: true },
      })) !== null;

    let authorizeUrl: string | null = null;
    let expiresAt: Date | null = null;
    if (!autoApplied) {
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
      authorizeUrl = `${getAuthConfig().baseURL}/authorize/${link.token}`;
      expiresAt = link.expiresAt;
    }

    // Text the decision link when the customer has a phone and SMS is
    // configured (ADR 0008 resolution; failures never block the email).
    const woRow = await this.db.workOrder.findFirst({
      where: { id: workOrderId, organizationId },
      select: {
        customerId: true,
        customer: {
          select: {
            primaryPhone: true,
            contacts: {
              where: { phone: { not: null } },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
              take: 1,
              select: { phone: true },
            },
          },
        },
      },
    });
    const smsPhone = woRow?.customer.contacts[0]?.phone ?? woRow?.customer.primaryPhone ?? null;
    let smsBody: string | null = null;
    if (autoApplied) {
      smsBody = null; // No decision needed for auto-applied credits.
    }

    let email: Readonly<{ subject: string; text: string }>;
    if (revision.documentKind === "CHANGE_ORDER") {
      const totals = await getAuthorizedTotals(this.db, { organizationId, workOrderId });
      email = buildChangeOrderEmail({
        organizationName: revision.organization.name,
        workOrderNumber: revision.workOrder.number,
        changeOrderNumber: revision.changeOrderNumber ?? 0,
        note: revision.summaryNote ?? "Additional work discovered during service.",
        deltaMinor: revision.totalMinor.toString(),
        currency: revision.currency,
        previouslyApprovedMinor: (totals
          ? totals.cumulativeApprovedMinor - Number(revision.totalMinor)
          : 0
        ).toString(),
        newTotalMinor: (totals
          ? totals.cumulativeApprovedMinor
          : Number(revision.totalMinor)
        ).toString(),
        authorizeUrl,
        expiresAt,
      });
    } else {
      email = buildEstimateAuthorizationEmail({
        organizationName: revision.organization.name,
        workOrderNumber: revision.workOrder.number,
        revisionNumber: revision.revisionNumber,
        totalMinor: revision.totalMinor.toString(),
        currency: revision.currency,
        authorizeUrl: authorizeUrl ?? "",
        expiresAt: expiresAt ?? new Date(),
      });
    }

    const outcome = await sendTransactionalEmail({
      db: this.db,
      organizationId,
      to: recipient,
      subject: email.subject,
      text: email.text,
    });

    // Text the approval link when possible; failure to send never blocks the
    // event (the email already carried the link).
    if (smsPhone && !autoApplied && authorizeUrl) {
      try {
        await sendCustomerSms({
          db: this.db,
          context: {
            actorId: woRow!.customerId, // system send; customer-scoped conversation
            organizationId,
            membershipId: "00000000-0000-4000-8000-000000000000",
            requestId: input.event.id,
            organizationWideLocationAccess: true,
            allowedLocationIds: new Set<string>(),
            permissions: new Set(["customers.write"] as const),
          } as import("@/modules/tenancy/policy").TenantContext,
          customerId: woRow!.customerId,
          to: smsPhone,
          body: `${
            revision.documentKind === "CHANGE_ORDER"
              ? `Additional work found on ${revision.workOrder.number}.`
              : `Estimate ready for ${revision.workOrder.number}.`
          } Approve or decline: ${authorizeUrl}`,
          workOrderId,
        });
      } catch {
        // Not configured or invalid number — the email is the carrier of record.
      }
    }
    void smsBody;

    // The URL (and therefore token) must never appear in activity summaries.
    await this.recordActivity({
      organizationId,
      locationId,
      workOrderId,
      eventType: outcome.delivered ? "estimate.email_sent" : "estimate.email_unavailable",
      summary: outcome.delivered
        ? revision.documentKind === "CHANGE_ORDER"
          ? `Change order ${revision.changeOrderNumber} ${autoApplied ? "notification" : "authorization"} email sent to the customer.`
          : `Authorization email sent to the customer for revision ${revision.revisionNumber}.`
        : `Email connector not configured; the ${revision.documentKind === "CHANGE_ORDER" ? `change order ${revision.changeOrderNumber}` : `revision ${revision.revisionNumber}`} email was not sent. Re-send after configuring email.`,
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
