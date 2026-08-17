import { z } from "zod";

import { db } from "@/db/client";
import { validateAuthorizationLink } from "@/modules/estimates/authorization-link-service";
import { AuthorizationLinkFailed } from "@/modules/estimates/authorization-link-service";

export const dynamic = "force-dynamic";

/**
 * Public customer authorization endpoint — no authentication required.
 * GET returns the estimate details for the linked token.
 * POST records the customer's approve/decline decisions.
 */

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;

  try {
    const data = await validateAuthorizationLink(db, token);
    return Response.json(
      {
        workOrderNumber: data.workOrderNumber,
        organizationName: data.organizationName,
        customerName: data.customerName,
        revisionNumber: data.revisionNumber,
        documentKind: data.documentKind,
        changeOrderNumber: data.changeOrderNumber,
        summaryNote: data.summaryNote,
        currency: data.currency,
        totalMinor: data.totalMinor,
        previouslyApprovedMinor: data.previouslyApprovedMinor,
        lines: data.lines,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationLinkFailed) {
      const status = error.reason === "link_not_found" ? 404 : 410;
      return Response.json({ error: error.reason }, { status });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

const decisionSchema = z.object({
  decisions: z
    .array(
      z.object({
        estimateLineId: z.string().uuid(),
        decision: z.enum(["APPROVED", "DECLINED"]),
      }),
    )
    .min(1),
  providedByName: z.string().trim().min(1).max(180),
  note: z.string().max(2000).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    // Validate the link first.
    const linkData = await validateAuthorizationLink(db, token);

    // Verify all line IDs belong to this revision.
    const lineIds = parsed.data.decisions.map((d) => d.estimateLineId);
    const validLines = linkData.lines.filter((l) => lineIds.includes(l.id));
    if (validLines.length !== lineIds.length) {
      return Response.json({ error: "line_not_in_revision" }, { status: 400 });
    }

    // Record the authorization directly (no tenant context — the link IS the authorization).
    const { randomUUID } = await import("node:crypto");
    const authorization = await db.authorization.create({
      data: {
        id: randomUUID(),
        organizationId: linkData.organizationId,
        estimateRevisionId: linkData.revisionId,
        method: "CUSTOMER_LINK",
        providedByName: parsed.data.providedByName,
        note: parsed.data.note ?? null,
        occurredAt: new Date(),
      },
    });

    for (const decision of parsed.data.decisions) {
      await db.authorizationDecision.create({
        data: {
          organizationId: linkData.organizationId,
          authorizationId: authorization.id,
          estimateLineId: decision.estimateLineId,
          decision: decision.decision,
        },
      });
    }

    // Mark the link as used.
    const { markLinkUsed } = await import("@/modules/estimates/authorization-link-service");
    await markLinkUsed(db, linkData.linkId);

    // Customer receipt email via the outbox (same event as staff-recorded
    // decisions, so every recorded decision produces one receipt).
    await db.outboxEvent.create({
      data: {
        id: randomUUID(),
        organizationId: linkData.organizationId,
        eventType: "authorization.recorded",
        aggregateType: "authorization",
        aggregateId: authorization.id,
        payload: {
          revisionId: linkData.revisionId,
          workOrderId: linkData.workOrderId,
          locationId: linkData.locationId,
        },
      },
    });

    // Transition the work order to AUTHORIZED if at least one line was approved.
    const hasApproval = parsed.data.decisions.some((d) => d.decision === "APPROVED");
    if (hasApproval) {
      const revision = await db.estimateRevision.findUnique({
        where: { id: linkData.revisionId },
        select: { workOrderId: true },
      });
      if (revision) {
        // Update work order status directly (no tenant context available).
        await db.workOrder.updateMany({
          where: { id: revision.workOrderId, status: "AWAITING_AUTHORIZATION" },
          data: { status: "AUTHORIZED" },
        });

        // Record an activity event.
        const wo = await db.workOrder.findUnique({
          where: { id: revision.workOrderId },
          select: { locationId: true },
        });
        if (wo) {
          await db.activityEvent.create({
            data: {
              id: randomUUID(),
              organizationId: linkData.organizationId,
              locationId: wo.locationId,
              workOrderId: revision.workOrderId,
              eventType: "authorization.recorded",
              summary: `Customer authorization recorded via link by ${parsed.data.providedByName}.`,
            },
          });
        }
      }
    }

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationLinkFailed) {
      const status = error.reason === "link_not_found" ? 404 : 410;
      return Response.json({ error: error.reason }, { status });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
