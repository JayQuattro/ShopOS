import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  getShopProfile,
  OrgProfileFailed,
  updateShopProfile,
} from "@/modules/organizations/org-profile-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    const profile = await getShopProfile(db, tenantContext);
    return Response.json(profile, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return profileError(error);
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(2).max(180),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  contactEmail: z.string().trim().max(320).nullable().optional(),
  website: z.string().trim().max(2048).nullable().optional(),
  addressLine1: z.string().trim().max(220).nullable().optional(),
  addressLine2: z.string().trim().max(220).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  stateProvince: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  country: z.string().trim().length(2).nullable().optional(),
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

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    await updateShopProfile(db, tenantContext, {
      name: parsed.data.name,
      ...(parsed.data.contactPhone !== undefined ? { contactPhone: parsed.data.contactPhone } : {}),
      ...(parsed.data.contactEmail !== undefined ? { contactEmail: parsed.data.contactEmail } : {}),
      ...(parsed.data.website !== undefined ? { website: parsed.data.website } : {}),
      ...(parsed.data.addressLine1 !== undefined ? { addressLine1: parsed.data.addressLine1 } : {}),
      ...(parsed.data.addressLine2 !== undefined ? { addressLine2: parsed.data.addressLine2 } : {}),
      ...(parsed.data.city !== undefined ? { city: parsed.data.city } : {}),
      ...(parsed.data.stateProvince !== undefined
        ? { stateProvince: parsed.data.stateProvince }
        : {}),
      ...(parsed.data.postalCode !== undefined ? { postalCode: parsed.data.postalCode } : {}),
      ...(parsed.data.country !== undefined ? { country: parsed.data.country } : {}),
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return profileError(error);
  }
}

function profileError(error: unknown): Response {
  if (error instanceof OrgProfileFailed) {
    return Response.json({ error: error.reason }, { status: 400 });
  }
  return mapTenantError(error);
}
