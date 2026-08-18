import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { BayFailed, createBay, deactivateBay, listBays } from "@/modules/organizations/bay-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ locationId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { locationId } = await context.params;
    const includeInactive = new URL(request.url).searchParams.get("all") === "1";
    const bays = await listBays({
      db,
      context: tenantContext,
      locationId,
      ...(includeInactive ? { includeInactive } : {}),
    });
    return Response.json({ bays }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return bayError(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("deactivate"), bayId: z.string().uuid() }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ locationId: string }> },
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
    const { locationId } = await context.params;
    if (parsed.data.action === "create") {
      const result = await createBay({
        db,
        context: tenantContext,
        locationId,
        name: parsed.data.name,
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    await deactivateBay({ db, context: tenantContext, bayId: parsed.data.bayId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return bayError(error);
  }
}

function bayError(error: unknown): Response {
  if (error instanceof BayFailed) {
    const statusMap: Record<string, number> = {
      location_not_found: 404,
      bay_not_found: 404,
      duplicate_name: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
