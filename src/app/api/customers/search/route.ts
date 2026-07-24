import { z } from "zod";

import { db } from "@/db/client";
import { searchCustomers } from "@/modules/customers/customer-search";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  try {
    const context = await getRequestContext();
    const results = await searchCustomers(
      limit !== undefined ? { db, context, query, limit } : { db, context, query },
    );
    return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

void z;
