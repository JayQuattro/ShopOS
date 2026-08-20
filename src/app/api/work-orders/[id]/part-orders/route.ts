import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  cancelPartOrder,
  createPartOrder,
  createSupplier,
  listPartOrders,
  listSuppliers,
  markOrdered,
  PartOrderFailed,
  receiveItems,
} from "@/modules/parts/part-order-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const [orders, suppliers] = await Promise.all([
      listPartOrders({ db, context: tenantContext, workOrderId: id }),
      listSuppliers({ db, context: tenantContext }),
    ]);
    return Response.json(
      {
        orders: orders.map((order) => ({
          ...order,
          orderedAt: order.orderedAt?.toISOString() ?? null,
          receivedAt: order.receivedAt?.toISOString() ?? null,
        })),
        suppliers,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PartOrderFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}

const createOrderSchema = z.object({
  action: z.literal("create-order"),
  supplierId: z.string().uuid(),
  note: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(2).max(300),
        partNumber: z.string().trim().max(120).optional(),
        inventoryItemId: z.string().uuid().optional(),
        quantity: z.number().int().min(1),
        unitCostMinor: z.number().int().min(0),
      }),
    )
    .min(1),
});

const createSupplierSchema = z.object({
  action: z.literal("create-supplier"),
  name: z.string().trim().min(2).max(180),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(320).optional(),
  website: z.string().trim().max(2048).optional(),
});

const postSchema = z.discriminatedUnion("action", [createOrderSchema, createSupplierSchema]);

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

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;

    if (parsed.data.action === "create-supplier") {
      const result = await createSupplier({
        db,
        context: tenantContext,
        name: parsed.data.name,
        ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
        ...(parsed.data.email ? { email: parsed.data.email } : {}),
        ...(parsed.data.website ? { website: parsed.data.website } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    const result = await createPartOrder({
      db,
      context: tenantContext,
      workOrderId: id,
      supplierId: parsed.data.supplierId,
      purpose: "JOB",
      lines: parsed.data.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitCostMinor: line.unitCostMinor,
        ...(line.partNumber ? { partNumber: line.partNumber } : {}),
        ...(line.inventoryItemId ? { inventoryItemId: line.inventoryItemId } : {}),
      })),
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PartOrderFailed) {
      const status =
        error.reason === "invalid_lines" || error.reason === "duplicate_supplier_name" ? 400 : 404;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}

const orderActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("mark-ordered"),
    trackingNumber: z.string().trim().max(180).optional(),
  }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("receive"),
    lines: z
      .array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(1) }))
      .min(1),
  }),
]);

export async function PUT(
  request: Request,
  _context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = orderActionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const partOrderId = new URL(request.url).searchParams.get("partOrderId");
    if (!partOrderId) {
      return Response.json({ error: "missing_partOrderId" }, { status: 400 });
    }

    if (parsed.data.action === "mark-ordered") {
      await markOrdered({
        db,
        context: tenantContext,
        partOrderId,
        ...(parsed.data.trackingNumber ? { trackingNumber: parsed.data.trackingNumber } : {}),
      });
    } else if (parsed.data.action === "cancel") {
      await cancelPartOrder({ db, context: tenantContext, partOrderId });
    } else {
      const result = await receiveItems({
        db,
        context: tenantContext,
        partOrderId,
        lines: parsed.data.lines,
      });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PartOrderFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
