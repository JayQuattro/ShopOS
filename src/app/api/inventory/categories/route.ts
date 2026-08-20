import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { createCategory, listCategories } from "@/modules/inventory/inventory-service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const categories = await listCategories({ db, context: tenantContext });
    return Response.json({ categories }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

const bodySchema = z.object({
  action: z.literal("create"),
  name: z.string().trim().min(2).max(120),
});

export async function POST(request: Request): Promise<Response> {
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
    const result = await createCategory({
      db,
      context: tenantContext,
      name: parsed.data.name,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}
