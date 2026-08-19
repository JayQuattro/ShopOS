import { randomUUID } from "node:crypto";

import type { PrismaClient, PaymentMethod } from "@/generated/prisma/client";
import { resolveDrawerForPayment } from "@/modules/billing/cash-drawer-service";
import { resolveRegionalSettings } from "@/modules/organizations/regional-settings";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type FieldPaymentInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class FieldPaymentFailed extends Error {
  constructor(public readonly reason: "service_call_not_found" | "invalid_amount") {
    super("The field payment could not be recorded.");
    this.name = "FieldPaymentFailed";
  }
}

/**
 * Records money collected on a roadside job — no estimate, no invoice, just
 * the tech and the customer settling up on scene. The payment anchors to the
 * service call, lands in the recorder's open till (their field drawer), and
 * never touches AR, which only sees invoiced money.
 */
export async function recordFieldPayment(
  input: FieldPaymentInput & {
    serviceCallId: string;
    amountMinor: number;
    method: PaymentMethod;
    reference?: string;
  },
): Promise<Readonly<{ paymentId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new FieldPaymentFailed("invalid_amount");
  }

  return input.db.$transaction(async (transaction) => {
    const call = await transaction.serviceCall.findFirst({
      where: { id: input.serviceCallId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true, status: true },
    });
    if (!call) throw new FieldPaymentFailed("service_call_not_found");

    const regional = await resolveRegionalSettings(
      transaction,
      input.context.organizationId,
      call.locationId,
    );

    const drawerSessionId = await resolveDrawerForPayment(
      transaction,
      input.context.organizationId,
      call.locationId,
      input.context.actorId,
    );

    const payment = await transaction.payment.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: call.locationId,
        serviceCallId: call.id,
        amountMinor: BigInt(input.amountMinor),
        currency: regional.currency,
        method: input.method,
        ...(input.reference ? { reference: input.reference.trim() } : {}),
        ...(drawerSessionId ? { drawerSessionId } : {}),
        receivedAt: new Date(),
        recordedByUserId: input.context.actorId,
      },
      select: { id: true },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: call.locationId,
        actorUserId: input.context.actorId,
        action: "payment.field_recorded",
        entityType: "service_call",
        entityId: call.id,
        requestId: input.context.requestId,
        after: { amountMinor: input.amountMinor, method: input.method },
      },
    });

    return { paymentId: payment.id };
  });
}

/** Money collected on scene for one call (for board chips and detail). */
export async function collectedForServiceCall(
  input: FieldPaymentInput & { serviceCallId: string },
): Promise<Readonly<{ totalMinor: bigint; currency: string | null }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  const aggregate = await input.db.payment.aggregate({
    where: {
      organizationId: input.context.organizationId,
      serviceCallId: input.serviceCallId,
    },
    _sum: { amountMinor: true },
  });
  const currencyRow = await input.db.payment.findFirst({
    where: {
      organizationId: input.context.organizationId,
      serviceCallId: input.serviceCallId,
    },
    select: { currency: true },
  });

  return {
    totalMinor: aggregate._sum.amountMinor ?? 0n,
    currency: currencyRow?.currency ?? null,
  };
}
