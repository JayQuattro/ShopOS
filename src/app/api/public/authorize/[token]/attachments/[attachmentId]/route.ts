import { db } from "@/db/client";
import { AuthorizationLinkFailed } from "@/modules/estimates/authorization-link-service";
import {
  AttachmentOperationFailed,
  downloadAttachmentForAuthorizationLink,
} from "@/modules/work-orders/attachment-service";

export const dynamic = "force-dynamic";

/**
 * Public, token-scoped evidence download. The authorization link is the
 * authorization (same model as the public decision route): only attachments
 * explicitly linked to the link's estimate document are reachable, and only
 * while the link is valid (not expired, revoked, or used).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; attachmentId: string }> },
): Promise<Response> {
  const { token, attachmentId } = await context.params;

  try {
    const file = await downloadAttachmentForAuthorizationLink(db, { token, attachmentId });
    return new Response(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        // Evidence photos render inline in the authorize page.
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationLinkFailed) {
      const status = error.reason === "link_not_found" ? 404 : 410;
      return Response.json({ error: error.reason }, { status });
    }
    if (error instanceof AttachmentOperationFailed) {
      const status = error.reason === "attachment_not_found" ? 404 : 503;
      return Response.json({ error: error.reason }, { status });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
