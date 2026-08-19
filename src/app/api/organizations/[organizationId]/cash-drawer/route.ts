import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  CashDrawerFailed,
  closeCashDrawer,
  getOpenCashDrawer,
  listClosedCashDrawers,
  openCashDrawer,
} from "@/modules/billing/cash-drawer-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const locationId = new URL(request.url).searchParams.get("locationId") ?? undefined;

    const [open, closed] = await Promise.all([
      locationId
        ? getOpenCashDrawer({ db, context: tenantContext, locationId })
        : Promise.resolve(null),
      listClosedCashDrawers({
        db,
        context: tenantContext,
        ...(locationId ? { locationId } : {}),
      }),
    ]);

    return Response.json(
      {
        open: open
          ? {
              ...open,
              openedAt: open.openedAt.toISOString(),
            }
          : null,
        closed: closed.map((session) => ({
          ...session,
          methodTotals: session.methodTotals,
          openedAt: session.openedAt.toISOString(),
          closedAt: session.closedAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return cashDrawerError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    locationId: z.string().uuid(),
    currency: z.string().trim().length(3),
    openingFloatMinor: z.number().int().min(0).optional(),
    note: z.string().trim().max(500).optional(),
    label: z.string().trim().max(80).optional(),
    shared: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("close"),
    sessionId: z.string().uuid(),
    countedCashMinor: z.number().int().min(0),
    note: z.string().trim().max(500).optional(),
  }),
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

    if (parsed.data.action === "open") {
      const result = await openCashDrawer({
        db,
        context: tenantContext,
        locationId: parsed.data.locationId,
        currency: parsed.data.currency,
        ...(parsed.data.openingFloatMinor !== undefined
          ? { openingFloatMinor: parsed.data.openingFloatMinor }
          : {}),
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
        ...(parsed.data.label ? { label: parsed.data.label } : {}),
        ...(parsed.data.shared !== undefined ? { shared: parsed.data.shared } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    const result = await closeCashDrawer({
      db,
      context: tenantContext,
      sessionId: parsed.data.sessionId,
      countedCashMinor: parsed.data.countedCashMinor,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return cashDrawerError(error);
  }
}

function cashDrawerError(error: unknown): Response {
  if (error instanceof CashDrawerFailed) {
    const statusMap: Record<string, number> = {
      session_not_found: 404,
      location_not_found: 404,
      drawer_already_open: 409,
      session_not_open: 409,
      invalid_amount: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
