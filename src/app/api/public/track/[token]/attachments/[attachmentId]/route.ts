import { db } from "@/db/client";
import { TrackerLinkFailed } from "@/modules/work-orders/tracker-link-service";
import {
  AttachmentOperationFailed,
  downloadAttachmentForTrackerLink,
} from "@/modules/work-orders/attachment-service";

export const dynamic = "force-dynamic";

/**
 * Public, tracker-token-scoped evidence photo download. A valid tracker link
 * unlocks only image attachments explicitly linked to this work order's
 * estimate documents — the same evidence the customer sees on their
 * authorize page.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; attachmentId: string }> },
): Promise<Response> {
  const { token, attachmentId } = await context.params;

  try {
    const file = await downloadAttachmentForTrackerLink(db, { token, attachmentId });
    return new Response(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof TrackerLinkFailed) {
      const status = error.reason === "invalid_token" ? 404 : 410;
      return Response.json({ error: error.reason }, { status });
    }
    if (error instanceof AttachmentOperationFailed) {
      const status = error.reason === "attachment_not_found" ? 404 : 503;
      return Response.json({ error: error.reason }, { status });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
