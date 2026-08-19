import { db } from "@/db/client";
import {
  AttachmentOperationFailed,
  downloadAttachmentForInspectionToken,
} from "@/modules/work-orders/attachment-service";

export const dynamic = "force-dynamic";

/** Public, inspection-share-token-scoped media (photos and videos). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; attachmentId: string }> },
): Promise<Response> {
  const { token, attachmentId } = await context.params;
  try {
    const file = await downloadAttachmentForInspectionToken(db, { token, attachmentId });
    return new Response(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AttachmentOperationFailed) {
      const status = error.reason === "attachment_not_found" ? 404 : 503;
      return Response.json({ error: error.reason }, { status });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
