import { z } from "zod";

import { db } from "@/db/client";
import { AssetRepository, type CreateAssetInput } from "@/modules/assets/asset-repository";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const createAssetSchema = z.object({
  customerId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(220),
  category: z.string().trim().min(1).max(80),
  subtype: z.string().trim().max(80).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  modelYear: z.number().int().min(1900).max(2100).optional(),
  serialNumber: z.string().trim().max(160).optional(),
  description: z.string().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;

  try {
    const context = await getRequestContext();
    const repo = new AssetRepository({ db, context });
    const assets = await repo.list({
      ...(customerId ? { customerId } : {}),
      ...(search ? { search } : {}),
    });
    return Response.json({ assets }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = createAssetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const context = await getRequestContext();
    const repo = new AssetRepository({ db, context });
    const asset = await repo.create(stripUndefined(parsed.data) as CreateAssetInput);
    return Response.json(
      { asset },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (candidate !== undefined) result[key] = candidate;
  }
  return result as T;
}
