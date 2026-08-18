import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  applyDeposit,
  DepositFailed,
  listDepositsForWorkOrder,
  listOpenDeposits,
  recordDeposit,
} from "@/modules/billing/deposit-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const workOrderId = new URL(request.url).searchParams.get("workOrderId");

    const deposits = workOrderId
      ? await listDepositsForWorkOrder({ db, context: tenantContext, workOrderId })
      : await listOpenDeposits({ db, context: tenantContext });

    return Response.json(
      {
        deposits: deposits.map((deposit) => ({
          ...deposit,
          amountMinor: deposit.amountMinor.toString(),
          receivedAt: deposit.receivedAt.toISOString(),
          appliedAt: deposit.appliedAt?.toISOString() ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return depositError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("record"),
    workOrderId: z.string().uuid(),
    amountMinor: z.number().int().positive(),
    currency: z.string().trim().length(3),
    method: z.enum(["CASH", "CARD_EXTERNAL", "CHECK", "BANK_TRANSFER", "OTHER"]),
    reference: z.string().trim().max(160).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("apply"), depositId: z.string().uuid() }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);

    if (parsed.data.action === "record") {
      const result = await recordDeposit({
        db,
        context: tenantContext,
        workOrderId: parsed.data.workOrderId,
        amountMinor: parsed.data.amountMinor,
        currency: parsed.data.currency,
        method: parsed.data.method,
        ...(parsed.data.reference ? { reference: parsed.data.reference } : {}),
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    const result = await applyDeposit({
      db,
      context: tenantContext,
      depositId: parsed.data.depositId,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return depositError(error);
  }
}

function depositError(error: unknown): Response {
  if (error instanceof DepositFailed) {
    const statusMap: Record<string, number> = {
      work_order_not_found: 404,
      invoice_not_found: 404,
      deposit_not_found: 404,
      invoice_wrong_work_order: 409,
      invoice_not_issued: 409,
      deposit_already_applied: 409,
      deposit_exceeds_balance: 409,
      invalid_amount: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
