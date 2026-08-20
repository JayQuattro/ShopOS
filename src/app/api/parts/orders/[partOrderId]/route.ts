import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { receiveItems } from "@/modules/parts/part-order-service";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("receive"),
    lines: z
      .array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(1) }))
      .min(1),
  }),
  z.object({ action: z.literal("receive-all") }),
]);

/**
 * Order-scoped receiving (job or stock orders alike — the vendor board lives
 * outside the work-order page). receive-all fills every outstanding line to
 * its ordered quantity; linked lines bump stock as always.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ partOrderId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { partOrderId } = await context.params;

    let lines = parsed.data.action === "receive" ? parsed.data.lines : undefined;
    if (parsed.data.action === "receive-all") {
      const order = await db.partOrder.findFirst({
        where: { id: partOrderId, organizationId: tenantContext.organizationId },
        select: {
          status: true,
          lines: { select: { id: true, quantity: true, receivedQuantity: true } },
        },
      });
      if (!order) return Response.json({ error: "order_not_found" }, { status: 404 });
      if (order.status !== "ORDERED") {
        return Response.json({ error: "invalid_transition" }, { status: 409 });
      }
      lines = order.lines
        .filter((line) => line.receivedQuantity < line.quantity)
        .map((line) => ({
          lineId: line.id,
          quantity: line.quantity - line.receivedQuantity,
        }));
      if (lines.length === 0) {
        return Response.json({ error: "nothing_to_receive" }, { status: 409 });
      }
    }

    const result = await receiveItems({
      db,
      context: tenantContext,
      partOrderId,
      lines: lines!,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}
