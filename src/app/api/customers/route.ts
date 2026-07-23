import { z } from "zod";

import { db } from "@/db/client";
import type { CreateCustomerInput } from "@/modules/customers/customer-repository";
import { CustomerRepository } from "@/modules/customers/customer-repository";
import { TenantContextNotResolved } from "@/modules/tenancy/resolve-tenant-context";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { TenantAccessDenied } from "@/modules/tenancy/policy";

export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

const createCustomerSchema = z.object({
  kind: z.enum(["INDIVIDUAL", "BUSINESS"]),
  displayName: z.string().trim().min(1).max(220),
  organizationReference: z.string().trim().max(64).optional(),
  primaryEmail: z.string().trim().max(320).optional(),
  primaryPhone: z.string().trim().max(40).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({ search: url.searchParams.get("search") ?? undefined });
  if (!parsed.success) {
    return Response.json({ error: "invalid_query" }, { status: 400 });
  }

  try {
    const context = await getRequestContext();
    const repo = new CustomerRepository({ db, context });
    const customers = await repo.list(parsed.data.search ? { search: parsed.data.search } : {});
    return Response.json({ customers }, { headers: { "Cache-Control": "no-store" } });
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

  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const context = await getRequestContext();
    const repo = new CustomerRepository({ db, context });
    const customer = await repo.create(stripUndefined(parsed.data) as CreateCustomerInput);
    return Response.json(
      { customer },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}

/**
 * Maps the tenant authorization and resolution errors to HTTP statuses. Returns
 * 401 when there is no authenticated session or selected organization, 403 when
 * the actor lacks permission, and a generic 500 otherwise — never leaking
 * whether a resource exists in another tenant.
 */
function mapTenantError(error: unknown): Response {
  if (error instanceof TenantContextNotResolved) {
    return Response.json({ error: error.reason }, { status: 401 });
  }
  if (error instanceof TenantAccessDenied) {
    return Response.json({ error: error.reason }, { status: 403 });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}

/**
 * Drops keys whose value is `undefined` so the result satisfies
 * `exactOptionalPropertyTypes` (which forbids explicit `undefined`). Zod's
 * optional fields parse to `string | undefined`; the repository's input type
 * declares them as optional-without-undefined.
 */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (candidate !== undefined) {
      result[key] = candidate;
    }
  }
  return result as T;
}
