import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type TrackerServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class TrackerLinkFailed extends Error {
  constructor(
    public readonly reason:
      "work_order_not_found" | "link_not_found" | "link_revoked" | "invalid_token",
  ) {
    super("The repair tracker operation could not be completed.");
    this.name = "TrackerLinkFailed";
  }
}

/**
 * Returns the work order's active tracker link, creating one if none exists.
 * A revoked link is not resurrected — call {@link regenerateTrackerLink}.
 */
export async function getOrCreateTrackerLink(
  input: TrackerServiceInput & { workOrderId: string },
): Promise<Readonly<{ token: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const workOrder = await input.db.workOrder.findFirst({
    where: { id: input.workOrderId, organizationId: input.context.organizationId },
    select: { id: true },
  });
  if (!workOrder) throw new TrackerLinkFailed("work_order_not_found");

  const existing = await input.db.repairTrackerLink.findUnique({
    where: {
      organizationId_workOrderId: {
        organizationId: input.context.organizationId,
        workOrderId: workOrder.id,
      },
    },
  });
  if (existing && !existing.revokedAt) return { token: existing.token };
  if (existing && existing.revokedAt) throw new TrackerLinkFailed("link_revoked");

  const link = await input.db.repairTrackerLink.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      workOrderId: workOrder.id,
      token: randomBytes(32).toString("base64url"),
    },
  });
  return { token: link.token };
}

/**
 * Rotates the token: the previous URL stops working immediately, and a fresh
 * one is issued in the same row.
 */
export async function regenerateTrackerLink(
  input: TrackerServiceInput & { workOrderId: string },
): Promise<Readonly<{ token: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const link = await loadLink(input.db, input.context, input.workOrderId);
  const token = randomBytes(32).toString("base64url");
  await input.db.repairTrackerLink.update({
    where: { id: link.id },
    data: { token, revokedAt: null },
  });
  return { token };
}

export async function revokeTrackerLink(
  input: TrackerServiceInput & { workOrderId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const link = await loadLink(input.db, input.context, input.workOrderId);
  await input.db.repairTrackerLink.update({
    where: { id: link.id },
    data: { revokedAt: new Date() },
  });
}

export async function getTrackerLinkStatus(
  input: TrackerServiceInput & { workOrderId: string },
): Promise<Readonly<{ token: string | null; revoked: boolean }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const link = await input.db.repairTrackerLink.findUnique({
    where: {
      organizationId_workOrderId: {
        organizationId: input.context.organizationId,
        workOrderId: input.workOrderId,
      },
    },
  });
  if (!link) return { token: null, revoked: false };
  return { token: link.revokedAt ? null : link.token, revoked: link.revokedAt !== null };
}

async function loadLink(db: PrismaClient, context: TenantContext, workOrderId: string) {
  const workOrder = await db.workOrder.findFirst({
    where: { id: workOrderId, organizationId: context.organizationId },
    select: { id: true },
  });
  if (!workOrder) throw new TrackerLinkFailed("work_order_not_found");

  const link = await db.repairTrackerLink.findUnique({
    where: {
      organizationId_workOrderId: {
        organizationId: context.organizationId,
        workOrderId: workOrder.id,
      },
    },
  });
  if (!link) throw new TrackerLinkFailed("link_not_found");
  return link;
}

// ─── Customer-facing projection ─────────────────────────────────────────────

const FRIENDLY_STATUS: Readonly<Record<string, string>> = {
  DRAFT: "Preparing your service order",
  ESTIMATING: "Preparing your estimate",
  AWAITING_AUTHORIZATION: "Waiting for your approval",
  AUTHORIZED: "Approved — preparing to start",
  IN_PROGRESS: "Your vehicle is being serviced",
  BLOCKED: "On hold — we'll update you shortly",
  COMPLETED: "Work complete — ready for pickup",
  INVOICED: "Invoice ready",
  CLOSED: "All done — thank you!",
  CANCELLED: "Cancelled",
};

export function friendlyWorkOrderStatus(status: string): string {
  return FRIENDLY_STATUS[status] ?? "In service";
}

/**
 * Only these activity types reach the customer, with labels written for them —
 * raw summaries are never exposed (they can carry internal detail like costs,
 * connector status, or email plumbing).
 */
const CUSTOMER_TIMELINE: ReadonlyArray<
  Readonly<{ eventType: string; label: (data: Record<string, unknown>) => string }>
> = [
  {
    eventType: "work_order.status_changed",
    label: (data) => friendlyWorkOrderStatus(String(data.to ?? "")),
  },
  { eventType: "estimate.presented", label: () => "Estimate sent for your approval" },
  {
    eventType: "change_order.presented",
    label: () => "Additional work update sent for your review",
  },
  { eventType: "authorization.recorded", label: () => "Your decision was recorded" },
  { eventType: "parts.ordered", label: () => "Parts ordered" },
  { eventType: "parts.received", label: () => "Parts arrived" },
  { eventType: "invoice.issued", label: () => "Invoice issued" },
  { eventType: "payment.recorded", label: () => "Payment received" },
];

export type RepairTrackerView = Readonly<{
  organizationName: string;
  workOrderNumber: string;
  customerName: string;
  statusLabel: string;
  awaitingApproval: boolean;
  awaitingParts: boolean;
  authorizeUrl: string | null;
  timeline: ReadonlyArray<Readonly<{ occurredAt: Date; label: string }>>;
  photos: ReadonlyArray<Readonly<{ id: string; fileName: string }>>;
  invoice: Readonly<{
    number: string;
    status: string;
    currency: string;
    totalMinor: string;
    paidMinor: string;
  }> | null;
}>;

/**
 * Builds the public live-status projection for a tracker token. The token is
 * the authorization (same model as the authorize route); everything served is
 * curated for the customer.
 */
export async function buildRepairTrackerView(
  db: PrismaClient,
  token: string,
): Promise<RepairTrackerView> {
  const link = await db.repairTrackerLink.findUnique({ where: { token } });
  if (!link) throw new TrackerLinkFailed("invalid_token");
  if (link.revokedAt) throw new TrackerLinkFailed("link_revoked");

  const workOrder = await db.workOrder.findUnique({
    where: { id: link.workOrderId },
    select: {
      id: true,
      number: true,
      status: true,
      customer: { select: { displayName: true } },
      organization: { select: { name: true } },
      invoice: {
        select: { number: true, status: true, currency: true, totalMinor: true, paidMinor: true },
      },
    },
  });
  if (!workOrder) throw new TrackerLinkFailed("invalid_token");

  const organizationId = link.organizationId;

  // Outstanding parts (REQUESTED or ORDERED).
  const outstandingParts = await db.partOrder.findFirst({
    where: { organizationId, workOrderId: workOrder.id, status: { in: ["REQUESTED", "ORDERED"] } },
    select: { id: true },
  });

  // An active, unused authorization link means a decision is pending; surface
  // its URL so the customer can act in place.
  const pendingAuthLink = await db.authorizationLink.findFirst({
    where: {
      organizationId,
      estimateRevision: { workOrderId: workOrder.id },
      revokedAt: null,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });

  const events = await db.activityEvent.findMany({
    where: {
      organizationId,
      workOrderId: workOrder.id,
      eventType: { in: CUSTOMER_TIMELINE.map((entry) => entry.eventType) },
    },
    orderBy: { occurredAt: "desc" },
    take: 20,
    select: { eventType: true, occurredAt: true, data: true },
  });

  const labelers = new Map(CUSTOMER_TIMELINE.map((entry) => [entry.eventType, entry.label]));
  const timeline = events
    .map((event) => ({
      occurredAt: event.occurredAt,
      label:
        labelers.get(event.eventType)?.((event.data ?? {}) as Record<string, unknown>) ?? "Update",
    }))
    .reverse();

  // Evidence photos attached to any document of this work order.
  const photos = await db.workOrderAttachment.findMany({
    where: {
      organizationId,
      workOrderId: workOrder.id,
      estimateRevisionId: { not: null },
      contentType: { startsWith: "image/" },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true },
  });

  return {
    organizationName: workOrder.organization.name,
    workOrderNumber: workOrder.number,
    customerName: workOrder.customer.displayName,
    statusLabel: friendlyWorkOrderStatus(workOrder.status),
    awaitingApproval: pendingAuthLink !== null,
    awaitingParts: outstandingParts !== null,
    authorizeUrl: pendingAuthLink ? `/authorize/${pendingAuthLink.token}` : null,
    timeline,
    photos,
    invoice: workOrder.invoice
      ? {
          number: workOrder.invoice.number,
          status: workOrder.invoice.status,
          currency: workOrder.invoice.currency,
          totalMinor: workOrder.invoice.totalMinor.toString(),
          paidMinor: workOrder.invoice.paidMinor.toString(),
        }
      : null,
  };
}
