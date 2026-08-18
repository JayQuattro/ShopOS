import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { ArFailed, listCustomerBalances } from "@/modules/billing/ar-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({ asOf: z.string().datetime().optional() });

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: "invalid_query" }, { status: 400 });
  }

  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const balances = await listCustomerBalances({
      db,
      context: tenantContext,
      ...(parsed.data.asOf ? { asOf: new Date(parsed.data.asOf) } : {}),
    });
    return Response.json(
      {
        balances: balances.map((balance) => ({
          ...balance,
          balanceMinor: balance.balanceMinor.toString(),
          currentMinor: balance.currentMinor.toString(),
          days31to60Minor: balance.days31to60Minor.toString(),
          days61to90Minor: balance.days61to90Minor.toString(),
          over90Minor: balance.over90Minor.toString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ArFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
