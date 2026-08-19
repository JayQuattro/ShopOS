import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  RegionalSettingsFailed,
  updateLocationRegionalSettings,
} from "@/modules/organizations/regional-settings";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  currency: z.string().trim().max(3).nullable().optional(),
  locale: z.string().trim().max(12).nullable().optional(),
  invoiceNumberPrefix: z.string().trim().max(12).nullable().optional(),
  phoneCountry: z.string().trim().length(2).nullable().optional(),
  cashRoundingMinor: z
    .number()
    .int()
    .refine((v) => [0, 1, 5, 10, 25, 50, 100, 500, 1000].includes(v))
    .optional(),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ organizationId: string; locationId: string }> },
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
    const { organizationId, locationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const effective = await updateLocationRegionalSettings({
      db,
      context: tenantContext,
      locationId,
      ...(parsed.data.currency !== undefined ? { currency: parsed.data.currency } : {}),
      ...(parsed.data.locale !== undefined ? { locale: parsed.data.locale } : {}),
      ...(parsed.data.invoiceNumberPrefix !== undefined
        ? { invoiceNumberPrefix: parsed.data.invoiceNumberPrefix }
        : {}),
      ...(parsed.data.phoneCountry !== undefined
        ? { phoneCountry: parsed.data.phoneCountry?.toUpperCase() ?? null }
        : {}),
      ...(parsed.data.cashRoundingMinor !== undefined
        ? { cashRoundingMinor: parsed.data.cashRoundingMinor }
        : {}),
    });
    return Response.json(effective, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RegionalSettingsFailed) {
      const statusMap: Record<string, number> = {
        location_not_found: 404,
        invalid_currency: 400,
        invalid_locale: 400,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
