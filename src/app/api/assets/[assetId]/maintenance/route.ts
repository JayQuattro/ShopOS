import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  createSchedule,
  deleteSchedule,
  listSchedulesForAsset,
  markServiced,
  PmFailed,
  recordAssetMileage,
} from "@/modules/assets/maintenance-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { assetId } = await context.params;
    const schedules = await listSchedulesForAsset({
      db,
      context: tenantContext,
      assetId,
    });
    return Response.json(
      {
        schedules: schedules.map((schedule) => ({
          ...schedule,
          lastServicedAt: schedule.lastServicedAt?.toISOString() ?? null,
          lastRemindedAt: schedule.lastRemindedAt?.toISOString() ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return pmError(error);
  }
}

const createSchema = z.object({
  action: z.literal("create"),
  name: z.string().trim().min(2).max(120),
  intervalMiles: z.number().int().min(1).optional(),
  intervalMonths: z.number().int().min(1).optional(),
  lastServicedAt: z.string().datetime().optional(),
  lastServicedMileage: z.number().int().min(0).optional(),
});

const servicedSchema = z.object({
  action: z.literal("serviced"),
  scheduleId: z.string().uuid(),
  mileage: z.number().int().min(0).optional(),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  scheduleId: z.string().uuid(),
});

const mileageSchema = z.object({
  action: z.literal("mileage"),
  mileage: z.number().int().min(0),
});

const bodySchema = z.discriminatedUnion("action", [
  createSchema,
  servicedSchema,
  deleteSchema,
  mileageSchema,
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
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
    const { assetId } = await context.params;

    if (parsed.data.action === "create") {
      const result = await createSchedule({
        db,
        context: tenantContext,
        assetId,
        name: parsed.data.name,
        ...(parsed.data.intervalMiles ? { intervalMiles: parsed.data.intervalMiles } : {}),
        ...(parsed.data.intervalMonths ? { intervalMonths: parsed.data.intervalMonths } : {}),
        ...(parsed.data.lastServicedAt
          ? { lastServicedAt: new Date(parsed.data.lastServicedAt) }
          : {}),
        ...(parsed.data.lastServicedMileage !== undefined
          ? { lastServicedMileage: parsed.data.lastServicedMileage }
          : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (parsed.data.action === "serviced") {
      await markServiced({
        db,
        context: tenantContext,
        scheduleId: parsed.data.scheduleId,
        ...(parsed.data.mileage !== undefined ? { mileage: parsed.data.mileage } : {}),
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (parsed.data.action === "delete") {
      await deleteSchedule({ db, context: tenantContext, scheduleId: parsed.data.scheduleId });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    await recordAssetMileage({ db, context: tenantContext, assetId, mileage: parsed.data.mileage });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return pmError(error);
  }
}

function pmError(error: unknown): Response {
  if (error instanceof PmFailed) {
    const statusMap: Record<string, number> = {
      asset_not_found: 404,
      schedule_not_found: 404,
      duplicate_schedule: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
