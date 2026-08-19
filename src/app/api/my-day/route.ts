import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * "My day" for the acting technician: their assigned jobs with stage,
 * bay, pending attention flags, and open task counts, plus their running
 * timer. One API the mobile view renders with big touch targets.
 */
export async function GET(): Promise<Response> {
  try {
    const context = await (await import("@/modules/tenancy/request-context")).getRequestContext();
    const actorId = context.actorId;

    const running = await db.timeEntry.findFirst({
      where: {
        organizationId: context.organizationId,
        userId: actorId,
        endedAt: null,
      },
      select: { id: true, workOrderId: true, startedAt: true },
    });

    const jobs = await db.workOrder.findMany({
      where: {
        organizationId: context.organizationId,
        assignedTechnicianUserId: actorId,
        status: { in: ["AUTHORIZED", "IN_PROGRESS", "BLOCKED"] },
        ...(context.organizationWideLocationAccess
          ? {}
          : { locationId: { in: [...context.allowedLocationIds] } }),
      },
      orderBy: { promisedAt: { sort: "asc", nulls: "last" } },
      select: {
        id: true,
        number: true,
        status: true,
        vehicleStage: true,
        boardStage: { select: { label: true } },
        bayLabel: true,
        promisedAt: true,
        customerConcern: true,
        customer: { select: { displayName: true } },
        asset: { select: { displayName: true } },
        tasks: { where: { status: "OPEN" }, select: { id: true, title: true } },
      },
      take: 25,
    });

    return Response.json(
      {
        technicianName: null,
        runningTimer: running
          ? {
              workOrderId: running.workOrderId,
              startedAt: running.startedAt.toISOString(),
            }
          : null,
        jobs: jobs.map((job) => ({
          ...job,
          promisedAt: job.promisedAt?.toISOString() ?? null,
          openTasks: job.tasks.map((task) => ({ id: task.id, title: task.title })),
          tasks: undefined,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return (await import("@/modules/tenancy/http-errors")).mapTenantError(error);
  }
}
