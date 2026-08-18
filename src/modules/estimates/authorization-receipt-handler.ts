import type { PrismaClient } from "@/generated/prisma/client";
import { formatMoney } from "@/i18n/formatters";
import type { EventHandler, EventHandlerInput } from "@/modules/outbox/event-handler";
import { getAuthorizedTotals } from "@/modules/estimates/change-order-service";
import { sendWorkOrderCustomerEmail } from "@/modules/notifications/send-work-order-customer-email";

export const AUTHORIZATION_RECORDED_EVENT = "authorization.recorded";

/** Default locale for customer email until per-customer locale preferences land (#60). */
const EMAIL_LOCALE = "en";

export type ReceiptLine = Readonly<{ description: string; amountMinor: string }>;

/**
 * Builds the customer's decision receipt (ADR 0014 provenance for every money
 * moment): exactly what was approved and declined, and the cumulative
 * authorized total for change orders. Pure and unit-tested.
 */
export function buildAuthorizationReceiptEmail(
  input: Readonly<{
    organizationName: string;
    workOrderNumber: string;
    documentKind: "BASELINE" | "CHANGE_ORDER";
    changeOrderNumber: number | null;
    currency: string;
    approved: ReadonlyArray<ReceiptLine>;
    declined: ReadonlyArray<ReceiptLine>;
    cumulativeAuthorizedMinor: string | null;
  }>,
): Readonly<{ subject: string; text: string }> {
  const isChangeOrder = input.documentKind === "CHANGE_ORDER";
  const documentLabel = isChangeOrder
    ? `change order ${input.changeOrderNumber ?? ""}`.trim()
    : "estimate";
  const money = (minor: string) => formatMoney(Number(minor), input.currency, EMAIL_LOCALE);

  const lines: string[] = [
    `${input.organizationName} has recorded your decision on the ${documentLabel} for ${input.workOrderNumber}.`,
    "",
  ];

  if (input.approved.length > 0) {
    lines.push("Approved:");
    for (const line of input.approved) {
      lines.push(`  • ${line.description} — ${money(line.amountMinor)}`);
    }
  }
  if (input.declined.length > 0) {
    if (input.approved.length > 0) lines.push("");
    lines.push("Declined (will not be performed):");
    for (const line of input.declined) {
      lines.push(`  • ${line.description} — ${money(line.amountMinor)}`);
    }
  }

  if (input.cumulativeAuthorizedMinor !== null) {
    lines.push(
      "",
      `Authorized total for ${input.workOrderNumber}: ${money(input.cumulativeAuthorizedMinor)}`,
    );
  }

  lines.push("", "Keep this email for your records. Contact the shop with any questions.");

  return {
    subject: `Your decision recorded — ${input.workOrderNumber} (${input.organizationName})`,
    text: lines.join("\n"),
  };
}

/**
 * Emails the customer a receipt when authorization decisions are recorded —
 * whether the customer acted on a link or staff recorded a verbal decision.
 */
export class AuthorizationRecordedEmailHandler implements EventHandler {
  readonly eventType = AUTHORIZATION_RECORDED_EVENT;

  constructor(private readonly db: PrismaClient) {}

  async handle(input: EventHandlerInput): Promise<void> {
    const revisionId = readString(input.event.data, "revisionId");
    const workOrderId = readString(input.event.data, "workOrderId");
    const locationId = readString(input.event.data, "locationId");
    if (!revisionId || !workOrderId || !locationId) {
      throw new Error("authorization.recorded payload missing required fields");
    }
    const organizationId = input.event.organizationId;

    const revision = await this.db.estimateRevision.findFirst({
      where: { id: revisionId, organizationId },
      select: {
        documentKind: true,
        changeOrderNumber: true,
        currency: true,
        organization: { select: { name: true, notifyDecisionReceiptEmail: true } },
        workOrder: { select: { number: true } },
        lines: {
          select: {
            description: true,
            totalMinor: true,
            authorizationDecisions: { select: { decision: true }, take: 1 },
          },
        },
      },
    });
    if (!revision) throw new Error("revision not found for receipt");
    if (!revision.organization.notifyDecisionReceiptEmail) return; // disabled by settings

    const approved: ReceiptLine[] = [];
    const declined: ReceiptLine[] = [];
    for (const line of revision.lines) {
      const decision = line.authorizationDecisions[0]?.decision;
      if (decision === "APPROVED") {
        approved.push({ description: line.description, amountMinor: line.totalMinor.toString() });
      } else if (decision === "DECLINED") {
        declined.push({ description: line.description, amountMinor: line.totalMinor.toString() });
      }
    }
    if (approved.length === 0 && declined.length === 0) {
      // Nothing decided yet (partial submissions enqueue again later).
      return;
    }

    const totals =
      revision.documentKind === "CHANGE_ORDER"
        ? await getAuthorizedTotals(this.db, { organizationId, workOrderId })
        : null;

    const email = buildAuthorizationReceiptEmail({
      organizationName: revision.organization.name,
      workOrderNumber: revision.workOrder.number,
      documentKind: revision.documentKind,
      changeOrderNumber: revision.changeOrderNumber,
      currency: revision.currency,
      approved,
      declined,
      cumulativeAuthorizedMinor: totals?.cumulativeApprovedMinor.toString() ?? null,
    });

    await sendWorkOrderCustomerEmail(this.db, {
      organizationId,
      workOrderId,
      locationId,
      subject: email.subject,
      text: email.text,
      activityScope: "authorization",
    });
  }
}

function readString(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
