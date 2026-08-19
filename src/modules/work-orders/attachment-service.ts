import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { resolveStorageProvider } from "@/modules/integrations/storage/storage-connector-service";

export type AttachmentFailedReason =
  | "work_order_not_found"
  | "attachment_not_found"
  | "revision_not_found"
  | "storage_not_configured"
  | "file_too_large"
  | "invalid_content_type";

export class AttachmentOperationFailed extends Error {
  constructor(public readonly reason: AttachmentFailedReason) {
    super("The attachment operation could not be completed.");
    this.name = "AttachmentOperationFailed";
  }
}

export type AttachmentSummary = Readonly<{
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByDisplayName: string | null;
  createdAt: Date;
  estimateLineId: string | null;
}>;

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export async function listAttachments(
  input: Readonly<{
    db: PrismaClient;
    context: TenantContext;
    workOrderId: string;
    estimateRevisionId?: string;
  }>,
): Promise<readonly AttachmentSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const attachments = await input.db.workOrderAttachment.findMany({
    where: {
      organizationId: input.context.organizationId,
      workOrderId: input.workOrderId,
      ...(input.estimateRevisionId ? { estimateRevisionId: input.estimateRevisionId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      uploadedBy: { select: { displayName: true } },
      createdAt: true,
      estimateLineId: true,
      inspectionItemId: true,
    },
  });

  return attachments.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    estimateLineId: a.estimateLineId,
    inspectionItemId: a.inspectionItemId,
    uploadedByDisplayName: a.uploadedBy?.displayName ?? null,
    createdAt: a.createdAt,
  }));
}

export async function uploadAttachment(
  input: Readonly<{
    db: PrismaClient;
    context: TenantContext;
    workOrderId: string;
    /** When set, the file is evidence for this estimate document and becomes visible to the customer through that document's authorization link. */
    estimateRevisionId?: string;
    /** When set, the file is inspection media for one checklist row. */
    inspectionItemId?: string;
    /** When set, the photo anchors to one estimate line (approval UX). */
    estimateLineId?: string;
    fileName: string;
    contentType: string;
    body: Uint8Array;
  }>,
): Promise<Readonly<{ attachmentId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (input.body.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new AttachmentOperationFailed("file_too_large");
  }
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    throw new AttachmentOperationFailed("invalid_content_type");
  }

  const storage = await resolveStorageProvider(input.db);
  if (!storage) {
    throw new AttachmentOperationFailed("storage_not_configured");
  }

  // Verify the work order exists in the same org.
  const workOrder = await input.db.workOrder.findFirst({
    where: {
      id: input.workOrderId,
      organizationId: input.context.organizationId,
    },
    select: { id: true, locationId: true },
  });
  if (!workOrder) throw new AttachmentOperationFailed("work_order_not_found");

  // An inspection-scoped upload must reference an item whose inspection
  // belongs to this work order in the same tenant.
  if (input.inspectionItemId) {
    const item = await input.db.inspectionItem.findFirst({
      where: {
        id: input.inspectionItemId,
        organizationId: input.context.organizationId,
        inspection: { workOrderId: input.workOrderId },
      },
      select: { id: true },
    });
    if (!item) throw new AttachmentOperationFailed("revision_not_found");
  }

  // A line-scoped photo must reference a line of this work order in the
  // same tenant (revision linkage follows the line's own revision).
  if (input.estimateLineId) {
    const line = await input.db.estimateLine.findFirst({
      where: {
        id: input.estimateLineId,
        organizationId: input.context.organizationId,
        revision: { workOrderId: input.workOrderId },
      },
      select: { id: true },
    });
    if (!line) throw new AttachmentOperationFailed("revision_not_found");
  }

  // A document-scoped upload must reference an estimate revision of this
  // work order in the same tenant.
  if (input.estimateRevisionId) {
    const revision = await input.db.estimateRevision.findFirst({
      where: {
        id: input.estimateRevisionId,
        organizationId: input.context.organizationId,
        workOrderId: input.workOrderId,
      },
      select: { id: true },
    });
    if (!revision) throw new AttachmentOperationFailed("revision_not_found");
  }

  const attachmentId = randomUUID();
  const objectKey = `work-orders/${input.workOrderId}/${attachmentId}/${input.fileName}`;

  await storage.put({
    organizationId: input.context.organizationId,
    objectKey,
    contentType: input.contentType,
    body: input.body,
  });

  await input.db.workOrderAttachment.create({
    data: {
      id: attachmentId,
      organizationId: input.context.organizationId,
      workOrderId: input.workOrderId,
      estimateRevisionId: input.estimateRevisionId ?? null,
      inspectionItemId: input.inspectionItemId ?? null,
      estimateLineId: input.estimateLineId ?? null,
      objectKey,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      uploadedByUserId: input.context.actorId,
    },
  });

  await input.db.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      locationId: workOrder.locationId,
      workOrderId: input.workOrderId,
      actorUserId: input.context.actorId,
      eventType: "attachment.uploaded",
      summary: `File attached: ${input.fileName}.`,
    },
  });

  return { attachmentId };
}

export async function downloadAttachment(
  input: Readonly<{
    db: PrismaClient;
    context: TenantContext;
    attachmentId: string;
  }>,
): Promise<
  Readonly<{
    fileName: string;
    contentType: string;
    body: Uint8Array;
  }>
> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const attachment = await input.db.workOrderAttachment.findFirst({
    where: {
      id: input.attachmentId,
      organizationId: input.context.organizationId,
    },
    select: { objectKey: true, fileName: true, contentType: true },
  });
  if (!attachment) throw new AttachmentOperationFailed("attachment_not_found");

  const storage = await resolveStorageProvider(input.db);
  if (!storage) throw new AttachmentOperationFailed("storage_not_configured");

  const body = await storage.get({
    organizationId: input.context.organizationId,
    objectKey: attachment.objectKey,
  });

  return {
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    body,
  };
}

export async function deleteAttachment(
  input: Readonly<{
    db: PrismaClient;
    context: TenantContext;
    attachmentId: string;
  }>,
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const attachment = await input.db.workOrderAttachment.findFirst({
    where: {
      id: input.attachmentId,
      organizationId: input.context.organizationId,
    },
    select: {
      id: true,
      objectKey: true,
      fileName: true,
      workOrderId: true,
      workOrder: { select: { locationId: true } },
    },
  });
  if (!attachment) throw new AttachmentOperationFailed("attachment_not_found");

  const storage = await resolveStorageProvider(input.db);
  if (storage) {
    await storage
      .delete({
        organizationId: input.context.organizationId,
        objectKey: attachment.objectKey,
      })
      .catch(() => undefined);
  }

  await input.db.workOrderAttachment.delete({
    where: { id: attachment.id },
  });

  await input.db.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      locationId: attachment.workOrder.locationId,
      workOrderId: attachment.workOrderId,
      actorUserId: input.context.actorId,
      eventType: "attachment.deleted",
      summary: `File removed: ${attachment.fileName}.`,
    },
  });
}

// ─── Public authorization-link access ───────────────────────────────────────
//
// A customer authorization link is the authorization (same model as the public
// decision route): the unguessable 32-byte token gates access. These helpers
// expose ONLY attachments explicitly linked to the document the token belongs
// to — work-order-wide attachments are never reachable through a link.

export async function listAttachmentsForAuthorizationLink(
  db: PrismaClient,
  token: string,
): Promise<readonly AttachmentSummary[]> {
  const { validateAuthorizationLink } =
    await import("@/modules/estimates/authorization-link-service");
  const link = await validateAuthorizationLink(db, token);

  const attachments = await db.workOrderAttachment.findMany({
    where: {
      organizationId: link.organizationId,
      workOrderId: link.workOrderId,
      estimateRevisionId: link.revisionId,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
      estimateLineId: true,
    },
  });

  return attachments.map((a) => ({
    id: a.id,
    estimateLineId: a.estimateLineId,
    fileName: a.fileName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    uploadedByDisplayName: null,
    createdAt: a.createdAt,
  }));
}

export async function downloadAttachmentForAuthorizationLink(
  db: PrismaClient,
  input: Readonly<{ token: string; attachmentId: string }>,
): Promise<Readonly<{ fileName: string; contentType: string; body: Uint8Array }>> {
  const { validateAuthorizationLink } =
    await import("@/modules/estimates/authorization-link-service");
  const link = await validateAuthorizationLink(db, input.token);

  // Scope by the link's document — an id from any other document (or a
  // work-order-wide attachment) is simply not found.
  const attachment = await db.workOrderAttachment.findFirst({
    where: {
      id: input.attachmentId,
      organizationId: link.organizationId,
      estimateRevisionId: link.revisionId,
    },
    select: { objectKey: true, fileName: true, contentType: true },
  });
  if (!attachment) throw new AttachmentOperationFailed("attachment_not_found");

  const storage = await resolveStorageProvider(db);
  if (!storage) throw new AttachmentOperationFailed("storage_not_configured");

  const body = await storage.get({
    organizationId: link.organizationId,
    objectKey: attachment.objectKey,
  });

  return {
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    body,
  };
}

/**
 * Serves a document-evidence photo through a customer repair-tracker token
 * (same model as the authorization-link access above): images attached to the
 * tracker's work-order documents only, while the link is unrevoked.
 */
export async function downloadAttachmentForTrackerLink(
  db: PrismaClient,
  input: Readonly<{ token: string; attachmentId: string }>,
): Promise<Readonly<{ fileName: string; contentType: string; body: Uint8Array }>> {
  const { buildRepairTrackerView, TrackerLinkFailed } =
    await import("@/modules/work-orders/tracker-link-service");
  try {
    await buildRepairTrackerView(db, input.token);
  } catch {
    throw new TrackerLinkFailed("invalid_token");
  }
  const link = await db.repairTrackerLink.findUnique({ where: { token: input.token } });

  const attachment = await db.workOrderAttachment.findFirst({
    where: {
      id: input.attachmentId,
      organizationId: link!.organizationId,
      workOrderId: link!.workOrderId,
      estimateRevisionId: { not: null },
      contentType: { startsWith: "image/" },
    },
    select: { objectKey: true, fileName: true, contentType: true },
  });
  if (!attachment) throw new AttachmentOperationFailed("attachment_not_found");

  const storage = await resolveStorageProvider(db);
  if (!storage) throw new AttachmentOperationFailed("storage_not_configured");

  const body = await storage.get({
    organizationId: link!.organizationId,
    objectKey: attachment.objectKey,
  });

  return { fileName: attachment.fileName, contentType: attachment.contentType, body };
}

/**
 * Public, inspection-token-scoped media download: a valid share token
 * unlocks only media attached to that inspection's items.
 */
export async function downloadAttachmentForInspectionToken(
  db: PrismaClient,
  input: Readonly<{ token: string; attachmentId: string }>,
): Promise<Readonly<{ fileName: string; contentType: string; body: Uint8Array }>> {
  const inspection = await db.inspection.findFirst({
    where: { sharedToken: input.token },
    select: { organizationId: true, items: { select: { id: true } } },
  });
  if (!inspection) throw new AttachmentOperationFailed("attachment_not_found");

  const itemIds = inspection.items.map((item) => item.id);
  const attachment = await db.workOrderAttachment.findFirst({
    where: {
      id: input.attachmentId,
      organizationId: inspection.organizationId,
      inspectionItemId: { in: itemIds },
    },
    select: { objectKey: true, fileName: true, contentType: true },
  });
  if (!attachment) throw new AttachmentOperationFailed("attachment_not_found");

  const storage = await resolveStorageProvider(db);
  if (!storage) throw new AttachmentOperationFailed("storage_not_configured");

  const body = await storage.get({
    organizationId: inspection.organizationId,
    objectKey: attachment.objectKey,
  });
  return { fileName: attachment.fileName, contentType: attachment.contentType, body };
}
