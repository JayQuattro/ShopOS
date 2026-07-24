import { z } from "zod";

import { db } from "@/db/client";
import { CustomerRepository } from "@/modules/customers/customer-repository";
import {
  archiveCustomer,
  CustomerMutationFailed,
  unarchiveCustomer,
  updateCustomer,
} from "@/modules/customers/customer-service";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(220).optional(),
  primaryEmail: z.string().trim().max(320).nullable().optional(),
  primaryPhone: z.string().trim().max(40).nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  customerFacingNotes: z.string().nullable().optional(),
});

const actionSchema = z.object({
  action: z.enum(["archive", "unarchive"]),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const repo = new CustomerRepository({ db, context: tenantContext });
    const customer = await repo.findById(id);
    if (!customer) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ customer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // Check if it's an archive/unarchive action.
  const actionParsed = actionSchema.safeParse(body);
  if (actionParsed.success) {
    try {
      const tenantContext = await getRequestContext();
      const { id } = await context.params;
      if (actionParsed.data.action === "archive") {
        await archiveCustomer({ db, context: tenantContext, customerId: id });
      } else {
        await unarchiveCustomer({ db, context: tenantContext, customerId: id });
      }
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof CustomerMutationFailed) {
        return Response.json({ error: error.reason }, { status: 404 });
      }
      return mapTenantError(error);
    }
  }

  // Otherwise it's a field update.
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const updateInput: Record<string, unknown> = { db, context: tenantContext, customerId: id };
    const d = parsed.data;
    if (d.displayName !== undefined) updateInput.displayName = d.displayName;
    if (d.primaryEmail !== undefined) updateInput.primaryEmail = d.primaryEmail ?? "";
    if (d.primaryPhone !== undefined) updateInput.primaryPhone = d.primaryPhone ?? "";
    if (d.internalNotes !== undefined) updateInput.internalNotes = d.internalNotes ?? "";
    if (d.customerFacingNotes !== undefined)
      updateInput.customerFacingNotes = d.customerFacingNotes ?? "";
    await updateCustomer(updateInput as Parameters<typeof updateCustomer>[0]);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CustomerMutationFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
