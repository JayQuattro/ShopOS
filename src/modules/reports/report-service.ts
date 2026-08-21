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

export type RevenueBucket = Readonly<{
  start: Date;
  invoicedMinor: number;
  collectedMinor: number;
}>;

function bucketStart(instant: Date, bucket: "day" | "week"): Date {
  const day = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  if (bucket === "day") return day;
  const weekday = (day.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - weekday * 24 * 60 * 60 * 1000);
}

/**
 * Invoiced and collected money over the window, bucketed by UTC day or week
 * (weeks start Monday). Empty buckets are included so charts keep their shape.
 */
export async function revenueTrend(
  input: ReportServiceInput & ReportRange & { bucket: "day" | "week" },
): Promise<readonly RevenueBucket[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );
  const orgId = input.context.organizationId;
  const bucketMs = (input.bucket === "day" ? 1 : 7) * 24 * 60 * 60 * 1000;

  const [invoices, payments] = await Promise.all([
    input.db.invoice.findMany({
      where: {
        organizationId: orgId,
        issuedAt: { gte: input.from, lt: input.to },
        status: { not: "VOID" },
      },
      select: { issuedAt: true, totalMinor: true },
    }),
    input.db.payment.findMany({
      where: { organizationId: orgId, receivedAt: { gte: input.from, lt: input.to } },
      select: { receivedAt: true, amountMinor: true },
    }),
  ]);

  const starts = new Map<number, { start: Date; invoicedMinor: number; collectedMinor: number }>();
  for (
    let t = bucketStart(input.from, input.bucket).getTime();
    t < input.to.getTime();
    t += bucketMs
  ) {
    starts.set(t, { start: new Date(t), invoicedMinor: 0, collectedMinor: 0 });
  }
  const bucketFor = (instant: Date) => starts.get(bucketStart(instant, input.bucket).getTime());
  for (const invoice of invoices) {
    if (!invoice.issuedAt) continue;
    const target = bucketFor(invoice.issuedAt);
    if (target) target.invoicedMinor += Number(invoice.totalMinor);
  }
  for (const payment of payments) {
    const target = bucketFor(payment.receivedAt);
    if (target) target.collectedMinor += Number(payment.amountMinor);
  }
  return [...starts.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

export type WorkMix = Readonly<{
  laborMinor: number;
  partsMinor: number;
  feesMinor: number;
  currency: string;
}>;

/** Revenue split across labor, parts, and fees from issued invoices in the window. */
export async function workMix(input: ReportServiceInput & ReportRange): Promise<WorkMix> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const [rows, currencyRow] = await Promise.all([
    input.db.invoiceLine.findMany({
      where: {
        organizationId: input.context.organizationId,
        invoice: {
          issuedAt: { gte: input.from, lt: input.to },
          status: { not: "VOID" },
        },
      },
      select: { kind: true, totalMinor: true },
    }),
    input.db.organization.findUnique({
      where: { id: input.context.organizationId },
      select: { defaultCurrency: true },
    }),
  ]);

  let laborMinor = 0;
  let partsMinor = 0;
  let feesMinor = 0;
  for (const line of rows) {
    const total = Number(line.totalMinor);
    if (line.kind === "LABOR") laborMinor += total;
    else if (line.kind === "PART") partsMinor += total;
    else feesMinor += total;
  }
  return {
    laborMinor,
    partsMinor,
    feesMinor,
    currency: currencyRow?.defaultCurrency ?? "USD",
  };
}

export type EstimateFunnel = Readonly<{
  presentedCount: number;
  presentedMinor: number;
  approvedMinor: number;
  declinedMinor: number;
  pendingMinor: number;
}>;

/**
 * Estimate conversion in the window: dollars presented vs approved vs
 * declined vs still pending, at line granularity. Superseded revisions are
 * excluded so a re-presented estimate is not double counted.
 */
export async function estimateFunnel(
  input: ReportServiceInput & ReportRange,
): Promise<EstimateFunnel> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );
  const orgId = input.context.organizationId;

  const revisions = await input.db.estimateRevision.findMany({
    where: {
      organizationId: orgId,
      presentedAt: { gte: input.from, lt: input.to },
      status: { in: ["PRESENTED", "EXPIRED"] },
    },
    select: { id: true, totalMinor: true },
  });
  const revisionIds = new Set(revisions.map((revision) => revision.id));

  const [lines, unrequiredLines] = await Promise.all([
    input.db.estimateLine.findMany({
      where: {
        organizationId: orgId,
        authorizationRequired: true,
        estimateRevisionId: { in: [...revisionIds] },
      },
      select: {
        totalMinor: true,
        authorizationDecisions: { select: { decision: true } },
      },
    }),
    input.db.estimateLine.findMany({
      where: {
        organizationId: orgId,
        authorizationRequired: false,
        estimateRevisionId: { in: [...revisionIds] },
      },
      select: { totalMinor: true },
    }),
  ]);

  const presentedMinor = revisions.reduce((sum, revision) => sum + Number(revision.totalMinor), 0);
  let approvedMinor = 0;
  let declinedMinor = 0;
  for (const line of lines) {
    const total = Number(line.totalMinor);
    const decisions = line.authorizationDecisions.map((decision) => decision.decision);
    if (decisions.includes("APPROVED")) approvedMinor += total;
    else if (decisions.includes("DECLINED")) declinedMinor += total;
  }
  // Non-authorization lines (fees, shop supplies) ride along with approval.
  for (const line of unrequiredLines) approvedMinor += Number(line.totalMinor);

  // Revision totals can drift from line sums (voided lines, adjustments);
  // never report more decided money than was presented.
  if (approvedMinor + declinedMinor > presentedMinor) {
    approvedMinor = Math.max(0, presentedMinor - declinedMinor);
  }
  return {
    presentedCount: revisions.length,
    presentedMinor,
    approvedMinor,
    declinedMinor,
    pendingMinor: Math.max(0, presentedMinor - approvedMinor - declinedMinor),
  };
}

export type TopJob = Readonly<{
  label: string;
  invoiceCount: number;
  minor: number;
}>;

/**
 * Highest-revenue job groups in the window, labeled by the source estimate
 * line's service group (e.g. "Front brakes"). Ungrouped lines roll into
 * "Other items".
 */
export async function topJobs(
  input: ReportServiceInput & ReportRange & { limit?: number },
): Promise<readonly TopJob[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );
  const orgId = input.context.organizationId;

  const lines = await input.db.invoiceLine.findMany({
    where: {
      organizationId: orgId,
      invoice: {
        issuedAt: { gte: input.from, lt: input.to },
        status: { not: "VOID" },
      },
    },
    select: {
      invoiceId: true,
      totalMinor: true,
      sourceEstimateLine: {
        select: { serviceGroupKey: true, serviceGroupLabel: true },
      },
    },
  });

  const byLabel = new Map<string, { minor: number; invoices: Set<string> }>();
  for (const line of lines) {
    const group = line.sourceEstimateLine;
    const label =
      group?.serviceGroupLabel ??
      (group && group.serviceGroupKey !== "general" ? group.serviceGroupKey : null) ??
      "Other items";
    if (!byLabel.has(label)) byLabel.set(label, { minor: 0, invoices: new Set() });
    const entry = byLabel.get(label)!;
    entry.minor += Number(line.totalMinor);
    entry.invoices.add(line.invoiceId);
  }
  return [...byLabel.entries()]
    .map(([label, entry]) => ({ label, invoiceCount: entry.invoices.size, minor: entry.minor }))
    .sort((a, b) => b.minor - a.minor)
    .slice(0, input.limit ?? 5);
}
