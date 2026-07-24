import { z } from "zod";

import { db } from "@/db/client";
import { addContact, CustomerMutationFailed } from "@/modules/customers/customer-service";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const addContactSchema = z.object({
  name: z.string().trim().min(1).max(220),
  role: z.string().trim().max(120).optional(),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = addContactSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const result = await addContact({
      db,
      context: tenantContext,
      customerId: id,
      name: parsed.data.name,
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
      ...(parsed.data.email ? { email: parsed.data.email } : {}),
      ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.isPrimary !== undefined ? { isPrimary: parsed.data.isPrimary } : {}),
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    });
    return Response.json(
      { contactId: result.contactId },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof CustomerMutationFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
