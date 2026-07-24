import { z } from "zod";

import { db } from "@/db/client";
import { assertTenantAccess } from "@/modules/tenancy/policy";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { mapTenantError } from "@/modules/tenancy/http-errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { organizationId } = await context.params;
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }

    const publication = await db.organizationThemePublication.findFirst({
      where: { organizationId },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        preset: true,
        accentHue: true,
        radiusScale: true,
        densityDefault: true,
        logoUrl: true,
        publishedAt: true,
      },
    });

    return Response.json({ theme: publication }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

const publishThemeSchema = z.object({
  preset: z.enum(["light", "dark", "warm", "dusk"]),
  accentHue: z.number().int().min(0).max(360).nullable().optional(),
  radiusScale: z.enum(["standard", "sharp", "round"]).optional(),
  densityDefault: z.enum(["comfortable", "compact"]).optional(),
  logoUrl: z.string().max(2048).nullable().optional(),
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

  const parsed = publishThemeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { organizationId } = await context.params;
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }

    // Publishing an org theme requires the organizations.manage capability.
    assertTenantAccess(
      tenantContext,
      { organizationId: tenantContext.organizationId },
      "organizations.manage",
    );

    // Determine the next version number.
    const latest = await db.organizationThemePublication.findFirst({
      where: { organizationId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const publication = await db.organizationThemePublication.create({
      data: {
        organizationId,
        version: nextVersion,
        preset: parsed.data.preset,
        accentHue: parsed.data.accentHue ?? null,
        radiusScale: parsed.data.radiusScale ?? "standard",
        densityDefault: parsed.data.densityDefault ?? "comfortable",
        logoUrl: parsed.data.logoUrl ?? null,
        publishedByUserId: tenantContext.actorId,
      },
      select: {
        id: true,
        version: true,
        preset: true,
        accentHue: true,
        radiusScale: true,
        densityDefault: true,
        logoUrl: true,
        publishedAt: true,
      },
    });

    return Response.json(
      { theme: publication },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}
