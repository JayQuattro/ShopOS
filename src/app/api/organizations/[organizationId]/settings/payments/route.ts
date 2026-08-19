import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  getOrgPaymentsConnector,
  PAYMENTS_ADAPTER_DEFINITIONS,
  PaymentsConnectorOperationFailed,
  upsertOrgPaymentsConnector,
} from "@/modules/integrations/payments/payments-connector-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const connector = await getOrgPaymentsConnector(db, tenantContext);
    return Response.json(
      { connector, adapters: PAYMENTS_ADAPTER_DEFINITIONS },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return paymentsConnectorError(error);
  }
}

const bodySchema = z.object({
  adapterKey: z.string().trim().min(1),
  displayName: z.string().trim().min(1).max(180),
  secret: z.record(z.string(), z.string()),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
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
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const result = await upsertOrgPaymentsConnector({
      db,
      context: tenantContext,
      adapterKey: parsed.data.adapterKey,
      displayName: parsed.data.displayName,
      secret: parsed.data.secret,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return paymentsConnectorError(error);
  }
}

function paymentsConnectorError(error: unknown): Response {
  if (error instanceof PaymentsConnectorOperationFailed) {
    const statusMap: Record<string, number> = {
      invalid_adapter: 400,
      invalid_configuration: 400,
      encryption_key_missing: 500,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
