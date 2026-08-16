import { db } from "@/db/client";
import {
  AttachmentOperationFailed,
  deleteAttachment,
  downloadAttachment,
} from "@/modules/work-orders/attachment-service";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { attachmentId } = await context.params;
    const file = await downloadAttachment({
      db,
      context: tenantContext,
      attachmentId,
    });
    return new Response(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return attachmentError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { attachmentId } = await context.params;
    await deleteAttachment({ db, context: tenantContext, attachmentId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return attachmentError(error);
  }
}

function attachmentError(error: unknown): Response {
  if (error instanceof AttachmentOperationFailed) {
    const statusMap: Record<string, number> = {
      attachment_not_found: 404,
      storage_not_configured: 503,
    };
    const status = statusMap[error.reason] ?? 400;
    return Response.json({ error: error.reason }, { status });
  }
  return mapTenantError(error);
}
