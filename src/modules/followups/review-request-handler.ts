import type { PrismaClient } from "@/generated/prisma/client";
import type { EventHandler, EventHandlerInput } from "@/modules/outbox/event-handler";
import { getAuthConfig } from "@/modules/identity/config";
import { sendCustomerSms } from "@/modules/integrations/sms/sms-service";

export const WORK_ORDER_CLOSED_EVENT = "work_order.closed";

/**
 * Sends the customer a review request text when their job closes, with a
 * link to the live repair tracker (still valid for reference). Best-effort:
 * no phone or no SMS connector simply completes. Review-platform deep links
 * (Google/Yelp) can ride the same event later via connector config.
 */
export class ReviewRequestHandler implements EventHandler {
  readonly eventType = WORK_ORDER_CLOSED_EVENT;

  constructor(private readonly db: PrismaClient) {}

  async handle(input: EventHandlerInput): Promise<void> {
    const workOrderId = readString(input.event.data, "workOrderId");
    const locationId = readString(input.event.data, "locationId");
    if (!workOrderId || !locationId) {
      throw new Error("work_order.closed payload missing required fields");
    }
    const organizationId = input.event.organizationId;

    const workOrder = await this.db.workOrder.findFirst({
      where: { id: workOrderId, organizationId },
      select: {
        id: true,
        number: true,
        customerId: true,
        customer: {
          select: {
            displayName: true,
            primaryPhone: true,
            contacts: {
              where: { phone: { not: null } },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
              take: 1,
              select: { phone: true },
            },
          },
        },
        organization: { select: { name: true, notifyReviewRequests: true, reviewUrl: true } },
        trackerLink: { select: { token: true, revokedAt: true } },
      },
    });
    if (!workOrder) throw new Error("work order not found for review request");
    if (!workOrder.organization.notifyReviewRequests) return; // disabled by settings

    const phone = workOrder.customer.contacts[0]?.phone ?? workOrder.customer.primaryPhone;
    if (!phone) return; // Nothing to text — complete.

    const trackerUrl = workOrder.trackerLink?.revokedAt
      ? null
      : workOrder.trackerLink
        ? `${getAuthConfig().baseURL}/track/${workOrder.trackerLink.token}`
        : null;

    try {
      await sendCustomerSms({
        db: this.db,
        context: {
          actorId: workOrder.customerId,
          organizationId,
          membershipId: "00000000-0000-4000-8000-000000000000",
          requestId: `review:${workOrderId}`,
          organizationWideLocationAccess: true,
          allowedLocationIds: new Set<string>(),
          permissions: new Set(["customers.write"] as const),
        } as import("@/modules/tenancy/policy").TenantContext,
        customerId: workOrder.customerId,
        to: phone,
        body: buildReviewBody(
          workOrder.organization.name,
          workOrder.organization.reviewUrl,
          trackerUrl,
        ),
        workOrderId,
      });
    } catch {
      // No SMS configured — the closed invoice email already exists; complete.
    }
  }
}

/** The review ask: configured review page first, tracker summary as fallback. */
function buildReviewBody(
  organizationName: string,
  reviewUrl: string | null,
  trackerUrl: string | null,
): string {
  if (reviewUrl) {
    return `Thanks for choosing ${organizationName}! A quick review means the world: ${reviewUrl}`;
  }
  return `Thanks for choosing ${organizationName}! If we earned it, a quick review means the world${trackerUrl ? ` — see your service summary: ${trackerUrl}` : ""}.`;
}

function readString(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
