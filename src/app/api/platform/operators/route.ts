import { db } from "@/db/client";
import { listOperatorGrants } from "@/modules/platform/operator-grants";
import {
  PlatformContextNotResolved,
  PlatformPermissionDenied,
} from "@/modules/platform/authorization";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const context = await getPlatformRequestContext();
    const grants = await listOperatorGrants(db, context);
    return Response.json({ grants }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return platformErrorResponse(error);
  }
}

export function platformErrorResponse(error: unknown): Response {
  if (error instanceof PlatformContextNotResolved) {
    return Response.json({ error: "platform_access_unavailable" }, { status: 404 });
  }
  if (error instanceof PlatformPermissionDenied) {
    return Response.json({ error: "platform_permission_denied" }, { status: 403 });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}
