import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Public inspection view: the share token is the only authority (tracker
 * pattern) — no session, no organization guesswork. Media serves through a
 * token-scoped attachment route so the underlying storage keys never leak.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return Response.json({ error: "invalid_token" }, { status: 404 });
  }

  const inspection = await db.inspection.findFirst({
    where: { sharedToken: token },
    select: {
      title: true,
      completedAt: true,
      workOrder: {
        select: {
          number: true,
          organization: { select: { name: true, contactPhone: true } },
          customer: { select: { displayName: true } },
        },
      },
      items: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          zone: true,
          component: true,
          condition: true,
          note: true,
          attachments: { select: { id: true, fileName: true, contentType: true } },
        },
      },
    },
  });
  if (!inspection) {
    return Response.json({ error: "invalid_token" }, { status: 404 });
  }

  return Response.json(
    {
      organizationName: inspection.workOrder.organization.name,
      contactPhone: inspection.workOrder.organization.contactPhone,
      workOrderNumber: inspection.workOrder.number,
      customerName: inspection.workOrder.customer.displayName,
      title: inspection.title,
      completedAt: inspection.completedAt?.toISOString() ?? null,
      items: inspection.items,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
