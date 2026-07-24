import { z } from "zod";
import { cookies } from "next/headers";

import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { mapTenantError } from "@/modules/tenancy/http-errors";

export const dynamic = "force-dynamic";

const appearanceSchema = z.object({
  themePreference: z.enum(["system", "light", "dark", "warm", "dusk"]).optional(),
  densityPreference: z.enum(["comfortable", "compact"]).optional(),
});

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = appearanceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const context = await getRequestContext();

    const data: Record<string, string> = {};
    if (parsed.data.themePreference) {
      data.themePreference = parsed.data.themePreference;
    }
    if (parsed.data.densityPreference) {
      data.densityPreference = parsed.data.densityPreference;
    }

    if (Object.keys(data).length > 0) {
      await db.organizationMembership.update({
        where: { id: context.membershipId },
        data,
      });
    }

    // Set cookies so the root layout renders the correct <html> attributes on
    // the next server render, preventing a theme flash.
    const cookieStore = await cookies();
    if (parsed.data.themePreference) {
      const resolved =
        parsed.data.themePreference === "system" ? "light" : parsed.data.themePreference;
      cookieStore.set("shopos-theme-resolved", resolved, {
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }
    if (parsed.data.densityPreference) {
      cookieStore.set("shopos-density", parsed.data.densityPreference, {
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}
