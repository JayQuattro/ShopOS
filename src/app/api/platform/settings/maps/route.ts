import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import {
  PlatformContextNotResolved,
  PlatformPermissionDenied,
} from "@/modules/platform/authorization";
import {
  getPlatformMapsConnector,
  MapsConnectorOperationFailed,
  upsertPlatformMapsConnector,
} from "@/modules/integrations/maps/maps-connector-service";
import { MAPS_ADAPTER_DEFINITIONS } from "@/modules/integrations/maps/maps-connector-service";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const context = await getPlatformRequestContext();
    const connector = await getPlatformMapsConnector(db, context);
    return Response.json(
      { connector, adapters: MAPS_ADAPTER_DEFINITIONS },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapsError(error);
  }
}

const upsertSchema = z.object({
  adapterKey: z.string().min(1).max(64),
  displayName: z.string().trim().min(1).max(180),
  configuration: z.record(z.string(), z.unknown()),
  secret: z.record(z.string(), z.string()),
});

export async function PUT(request: Request): Promise<Response> {
  if (!hasTrustedMutationOrigin(request)) {
    return Response.json({ error: "untrusted_origin" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const context = await getPlatformRequestContext();
    const result = await upsertPlatformMapsConnector({
      db,
      context,
      adapterKey: parsed.data.adapterKey,
      displayName: parsed.data.displayName,
      configuration: parsed.data.configuration,
      secret: parsed.data.secret,
    });
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return mapsError(error);
  }
}

function mapsError(error: unknown): Response {
  if (error instanceof PlatformContextNotResolved) {
    return Response.json({ error: "platform_access_unavailable" }, { status: 404 });
  }
  if (error instanceof PlatformPermissionDenied) {
    return Response.json({ error: "platform_permission_denied" }, { status: 403 });
  }
  if (error instanceof MapsConnectorOperationFailed) {
    const statusMap: Record<string, number> = { connector_not_found: 404 };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}
