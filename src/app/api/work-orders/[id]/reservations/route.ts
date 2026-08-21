import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  InventoryFailed,
  activeReservedQuantities,
  issueReservationsForWorkOrder,
  listReservations,
  releaseReservation,
  reserveStock,
} from "@/modules/inventory/inventory-service";

export const dynamic = "force-dynamic";

const reserveSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1),
  note: z.string().trim().max(280).optional(),
});

const actionSchema = z.object({
  action: z.literal("release"),
  reservationId: z.string().min(1),
});

const issueSchema = z.object({ action: z.literal("issue-all") });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const tenantContext = await getRequestContext();
  try {
    const [reservations, items, reserved] = await Promise.all([
      listReservations({ db, context: tenantContext, workOrderId: id }),
      db.inventoryItem.findMany({
        where: { organizationId: tenantContext.organizationId },
        orderBy: { name: "asc" },
        take: 200,
        select: { id: true, name: true, partNumber: true, quantityOnHand: true },
      }),
      activeReservedQuantities(db, tenantContext),
    ]);
    return Response.json(
      {
        reservations,
        items: items.map((item) => ({
          id: item.id,
          label: `${item.partNumber} — ${item.name}`,
          onHand: item.quantityOnHand,
          available: Math.max(0, item.quantityOnHand - (reserved[item.id] ?? 0)),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = reserveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await context.params;
  try {
    const tenantContext = await getRequestContext();
    const result = await reserveStock({
      db,
      context: tenantContext,
      itemId: parsed.data.itemId,
      workOrderId: id,
      quantity: parsed.data.quantity,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return invError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const release = actionSchema.safeParse(body);
  const issue = issueSchema.safeParse(body);
  if (!release.success && !issue.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await context.params;
  try {
    const tenantContext = await getRequestContext();
    if (issue.success) {
      const result = await issueReservationsForWorkOrder({
        db,
        context: tenantContext,
        workOrderId: id,
      });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await releaseReservation({
      db,
      context: tenantContext,
      reservationId: release.data!.reservationId,
    });
    if (!result.released) {
      return Response.json({ error: "not_active" }, { status: 409 });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return invError(error);
  }
}

function invError(error: unknown): Response {
  if (error instanceof InventoryFailed) {
    const statusMap: Record<string, number> = {
      item_not_found: 404,
      work_order_not_found: 404,
      work_order_not_open: 409,
      line_not_found: 404,
      insufficient_stock: 409,
      invalid_quantity: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
