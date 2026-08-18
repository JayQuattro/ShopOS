import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type ReportServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export type ReportRange = Readonly<{ from: Date; to: Date }>;

export type BusinessSummary = Readonly<{
  workOrderCount: number;
  invoicedMinor: number;
  invoicedCurrency: string;
  paidMinor: number;
  outstandingMinor: number;
  averageRepairOrderMinor: number;
  declinedCount: number;
  declinedMinor: number;
  declinedRecoveredCount: number;
  declinedRecoveredMinor: number;
}>;

/** Revenue and volume over a window: invoiced totals, payments, ARO, declined-work recovery. */
export async function businessSummary(
  input: ReportServiceInput & ReportRange,
): Promise<BusinessSummary> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );
  const orgId = input.context.organizationId;

  const [workOrderCount, invoices, payments, currencyRow] = await Promise.all([
    input.db.workOrder.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: input.from, lt: input.to },
        status: { not: "CANCELLED" },
      },
    }),
    input.db.invoice.findMany({
      where: {
        organizationId: orgId,
        issuedAt: { gte: input.from, lt: input.to },
        status: { not: "VOID" },
      },
      select: { currency: true, totalMinor: true, paidMinor: true },
    }),
    input.db.payment.findMany({
      where: {
        organizationId: orgId,
        receivedAt: { gte: input.from, lt: input.to },
      },
      select: { currency: true, amountMinor: true },
    }),
    input.db.organization.findUnique({
      where: { id: orgId },
      select: { defaultCurrency: true },
    }),
  ]);

  const invoicedMinor = invoices.reduce((sum, invoice) => sum + Number(invoice.totalMinor), 0);
  const paidMinor = payments.reduce((sum, payment) => sum + Number(payment.amountMinor), 0);
  const outstandingMinor = Math.max(
    0,
    invoices.reduce(
      (sum, invoice) => sum + Number(invoice.totalMinor) - Number(invoice.paidMinor),
      0,
    ),
  );

  // Declined work in the window, and how much of it was later re-quoted
  // (re-quotes are change-order lines matching declined descriptions on the same WO).
  const declinedRows = await input.db.authorizationDecision.findMany({
    where: {
      decision: "DECLINED",
      organizationId: orgId,
      createdAt: { gte: input.from, lt: input.to },
      estimateLine: {
        revision: { workOrder: { status: { notIn: ["CANCELLED"] } } },
      },
    },
    select: {
      estimateLineId: true,
      estimateLine: { select: { description: true, totalMinor: true } },
    },
  });
  const declinedCount = declinedRows.length;
  const declinedMinor = declinedRows.reduce(
    (sum, row) => sum + Number(row.estimateLine.totalMinor),
    0,
  );

  // Recovered: a later change-order line on the same work order with the same description.
  const workOrderIds = await input.db.workOrder.findMany({
    where: {
      organizationId: orgId,
      createdAt: { gte: new Date(input.from.getTime() - 90 * 24 * 60 * 60 * 1000), lt: input.to },
    },
    select: { id: true },
  });
  const woIdSet = new Set(workOrderIds.map((wo) => wo.id));
  const requoteLines = await input.db.estimateLine.findMany({
    where: {
      organizationId: orgId,
      revision: {
        documentKind: "CHANGE_ORDER",
        presentedAt: { gte: input.from },
        workOrderId: { in: [...woIdSet] },
      },
    },
    select: { description: true, totalMinor: true },
  });
  const requoteByDescription = new Map<string, number>();
  for (const line of requoteLines) {
    requoteByDescription.set(
      line.description,
      (requoteByDescription.get(line.description) ?? 0) + Number(line.totalMinor),
    );
  }
  let declinedRecoveredCount = 0;
  let declinedRecoveredMinor = 0;
  for (const row of declinedRows) {
    if (requoteByDescription.has(row.estimateLine.description)) {
      declinedRecoveredCount += 1;
      declinedRecoveredMinor += Number(row.estimateLine.totalMinor);
    }
  }

  return {
    workOrderCount,
    invoicedMinor,
    invoicedCurrency: currencyRow?.defaultCurrency ?? "USD",
    paidMinor,
    outstandingMinor,
    averageRepairOrderMinor: invoices.length > 0 ? Math.round(invoicedMinor / invoices.length) : 0,
    declinedCount,
    declinedMinor,
    declinedRecoveredCount,
    declinedRecoveredMinor,
  };
}

export type TechnicianProductivity = Readonly<{
  userId: string;
  displayName: string;
  workOrdersAssigned: number;
  loggedMinutes: number;
  flaggedFindings: number;
  qualityChecksPassed: number;
}>;

/** Per-technician rollup for the window: assignments, clocked time, findings, QC passes. */
export async function technicianProductivity(
  input: ReportServiceInput & ReportRange,
): Promise<readonly TechnicianProductivity[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );
  const orgId = input.context.organizationId;

  const [assignments, timeEntries, qcPasses] = await Promise.all([
    input.db.workOrder.findMany({
      where: {
        organizationId: orgId,
        updatedAt: { gte: input.from, lt: input.to },
      },
      select: {
        assignedTechnicianUserId: true,
        assistingTechnicians: { select: { userId: true } },
        tasks: {
          where: { status: "NEEDS_ATTENTION" },
          select: { createdByUserId: true },
        },
      },
    }),
    input.db.timeEntry.findMany({
      where: {
        organizationId: orgId,
        startedAt: { gte: input.from, lt: input.to },
        endedAt: { not: null },
      },
      select: { userId: true, startedAt: true, endedAt: true },
    }),
    input.db.workOrder.findMany({
      where: {
        organizationId: orgId,
        qcPassedAt: { gte: input.from, lt: input.to },
      },
      select: { qcPassedByUserId: true },
    }),
  ]);

  const byUser = new Map<
    string,
    { assigned: number; minutes: number; flagged: number; qcPassed: number }
  >();
  const bucket = (userId: string) => {
    if (!byUser.has(userId)) {
      byUser.set(userId, { assigned: 0, minutes: 0, flagged: 0, qcPassed: 0 });
    }
    return byUser.get(userId)!;
  };

  for (const workOrder of assignments) {
    const participants = new Set<string>();
    if (workOrder.assignedTechnicianUserId) {
      participants.add(workOrder.assignedTechnicianUserId);
    }
    for (const assist of workOrder.assistingTechnicians) participants.add(assist.userId);
    for (const userId of participants) bucket(userId).assigned += 1;

    for (const task of workOrder.tasks) {
      if (task.createdByUserId) bucket(task.createdByUserId).flagged += 1;
    }
  }
  for (const entry of timeEntries) {
    if (!entry.endedAt) continue;
    const minutes = Math.max(
      0,
      Math.round((entry.endedAt.getTime() - entry.startedAt.getTime()) / 60_000),
    );
    bucket(entry.userId).minutes += minutes;
  }
  for (const workOrder of qcPasses) {
    if (workOrder.qcPassedByUserId) bucket(workOrder.qcPassedByUserId).qcPassed += 1;
  }

  if (byUser.size === 0) return [];

  const users = await input.db.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, displayName: true },
  });
  const nameById = new Map(users.map((user) => [user.id, user.displayName]));

  return [...byUser.entries()]
    .map(([userId, stats]) => ({
      userId,
      displayName: nameById.get(userId) ?? "Unknown",
      workOrdersAssigned: stats.assigned,
      loggedMinutes: stats.minutes,
      flaggedFindings: stats.flagged,
      qualityChecksPassed: stats.qcPassed,
    }))
    .sort((a, b) => b.loggedMinutes - a.loggedMinutes);
}

export type StatusBreakdown = Readonly<{ status: string; count: number }>;

/** Current pipeline distribution: how many jobs sit in each status. */
export async function statusBreakdown(
  input: ReportServiceInput,
): Promise<readonly StatusBreakdown[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const rows = await input.db.workOrder.groupBy({
    by: ["status"],
    where: {
      organizationId: input.context.organizationId,
      status: { notIn: ["CLOSED", "CANCELLED"] },
    },
    _count: { status: true },
  });
  return rows
    .map((row) => ({ status: row.status, count: row._count.status }))
    .sort((a, b) => b.count - a.count);
}
