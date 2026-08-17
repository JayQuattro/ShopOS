import { db } from "@/db/client";
import {
  TrackerLinkFailed,
  buildRepairTrackerView,
} from "@/modules/work-orders/tracker-link-service";

export const dynamic = "force-dynamic";

/**
 * Public customer repair tracker — no authentication required. The tracker
 * token is the authorization; the response is a curated projection (never raw
 * activity summaries).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;

  try {
    const view = await buildRepairTrackerView(db, token);
    return Response.json(
      {
        ...view,
        timeline: view.timeline.map((entry) => ({
          ...entry,
          occurredAt: entry.occurredAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof TrackerLinkFailed) {
      const status = error.reason === "invalid_token" ? 404 : 410;
      return Response.json({ error: error.reason }, { status });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
