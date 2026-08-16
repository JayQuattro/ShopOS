import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { resolveStorageProvider } from "@/modules/integrations/storage/storage-connector-service";

export type AttachmentFailedReason =
  | "work_order_not_found"
  | "attachment_not_found"
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
  input: Readonly<{ db: PrismaClient; context: TenantContext; workOrderId: string }>,
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
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      uploadedBy: { select: { displayName: true } },
      createdAt: true,
    },
  });

  return attachments.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    uploadedByDisplayName: a.uploadedBy?.displayName ?? null,
    createdAt: a.createdAt,
  }));
}

export async function uploadAttachment(
  input: Readonly<{
    db: PrismaClient;
    context: TenantContext;
    workOrderId: string;
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
