import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { sendTransactionalEmail } from "@/modules/integrations/email/transactional-email";

/**
 * Shared plumbing for customer notification emails that hang off a work
 * order: resolves the customer's primary email, sends through the tenant
 * connector chain (org → platform, ADR 0008), and records a work-order
 * activity event describing the outcome. Callers own the email content.
 *
 * Activity summaries never contain the message body or any link tokens.
 */
export async function sendWorkOrderCustomerEmail(
  db: PrismaClient,
  input: Readonly<{
    organizationId: string;
    workOrderId: string;
    locationId: string;
    subject: string;
    text: string;
    /** Activity event type prefix, e.g. "estimate" records estimate.email_sent. */
    activityScope: string;
  }>,
): Promise<"sent" | "unavailable" | "no_recipient"> {
  const workOrder = await db.workOrder.findFirst({
    where: { id: input.workOrderId, organizationId: input.organizationId },
    select: {
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
  });
  if (!workOrder) throw new Error("work order not found for notification");

  const recipient =
    workOrder.customer.contacts[0]?.email ?? workOrder.customer.primaryEmail ?? null;

  if (!recipient) {
    await db.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        locationId: input.locationId,
        workOrderId: input.workOrderId,
        eventType: `${input.activityScope}.email_skipped`,
        summary: "Customer email not sent: no contact email on file.",
      },
    });
    return "no_recipient";
  }

  const outcome = await sendTransactionalEmail({
    db,
    organizationId: input.organizationId,
    to: recipient,
    subject: input.subject,
    text: input.text,
  });

  await db.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      workOrderId: input.workOrderId,
      eventType: outcome.delivered
        ? `${input.activityScope}.email_sent`
        : `${input.activityScope}.email_unavailable`,
      summary: outcome.delivered
        ? `Email sent to the customer: "${input.subject}".`
        : `Email connector not configured; "${input.subject}" was not emailed.`,
    },
  });

  return outcome.delivered ? "sent" : "unavailable";
}
