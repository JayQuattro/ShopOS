import { db } from "@/db/client";
import {
  AttachmentOperationFailed,
  listAttachments,
  uploadAttachment,
} from "@/modules/work-orders/attachment-service";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const estimateRevisionId = new URL(request.url).searchParams.get("revisionId") ?? undefined;
    const attachments = await listAttachments({
      db,
      context: tenantContext,
      workOrderId: id,
      ...(estimateRevisionId ? { estimateRevisionId } : {}),
    });
    return Response.json({ attachments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return attachmentError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return Response.json({ error: "missing_file" }, { status: 400 });
  }

  const revisionField = formData.get("revisionId");
  const estimateRevisionId =
    typeof revisionField === "string" && revisionField.length > 0 ? revisionField : undefined;

  const body = new Uint8Array(await file.arrayBuffer());

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const result = await uploadAttachment({
      db,
      context: tenantContext,
      workOrderId: id,
      ...(estimateRevisionId ? { estimateRevisionId } : {}),
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      body,
    });
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return attachmentError(error);
  }
}

function attachmentError(error: unknown): Response {
  if (error instanceof AttachmentOperationFailed) {
    const statusMap: Record<string, number> = {
      work_order_not_found: 404,
      attachment_not_found: 404,
      revision_not_found: 404,
      storage_not_configured: 503,
      file_too_large: 413,
      invalid_content_type: 415,
    };
    const status = statusMap[error.reason] ?? 400;
    return Response.json({ error: error.reason }, { status });
  }
  return mapTenantError(error);
}
