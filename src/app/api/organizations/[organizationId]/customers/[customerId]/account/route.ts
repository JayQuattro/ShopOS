import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { ArFailed, setCustomerAccount } from "@/modules/billing/ar-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ isAccountCustomer: z.boolean() });

export async function PUT(
  request: Request,
  context: { params: Promise<{ organizationId: string; customerId: string }> },
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
    const { organizationId, customerId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    await setCustomerAccount({
      db,
      context: tenantContext,
      customerId,
      isAccountCustomer: parsed.data.isAccountCustomer,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ArFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
