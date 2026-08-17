import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";

const TEST_DATABASE_URL =
  process.env.SHOPOS_TEST_DATABASE_URL ?? "postgres://shopos:shopos@localhost:5432/shopos_test";
assertDedicatedTestDatabase(TEST_DATABASE_URL);

const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = TEST_DATABASE_URL;
env.BETTER_AUTH_URL = "http://localhost:3000";
env.BETTER_AUTH_SECRET = "integration-test-secret-at-least-32-characters-long";
env.NODE_ENV = "test";

function isPostgresReachable(url: string): boolean {
  try {
    const probePath = new URL("../identity/_probe-postgres.cjs", import.meta.url);
    execFileSync(process.execPath, [fileURLToPath(probePath)], {
      timeout: 3_000,
      stdio: "ignore",
      env: { ...process.env, SHOPOS_PROBE_URL: url },
    });
    return true;
  } catch {
    return false;
  }
}

const RUN = isPostgresReachable(TEST_DATABASE_URL);
const shouldSkip = !RUN;

type DbModule = typeof import("@/db/client");
let dbModule: DbModule;
let storageBasePath: string;

// A 1×1 transparent PNG.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

async function seedPresentedDocument() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Attach Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `u-${userId.slice(0, 8)}@example.test`,
        displayName: "Attach User",
      },
    }),
    dbModule.db.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId: orgId,
        userId,
        organizationWideLocationAccess: true,
      },
    }),
    dbModule.db.role.create({
      data: {
        id: roleId,
        organizationId: orgId,
        key: "owner",
        name: "Owner",
        permissions: ["work_orders.read", "work_orders.write", "estimates.present"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Attach Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-7001",
        customerConcern: "Grinding",
        status: "AWAITING_AUTHORIZATION",
      },
    }),
  ]);

  const wo = await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } });

  const makeRevision = async (revisionNumber: number, kind: "BASELINE" | "CHANGE_ORDER") =>
    dbModule.db.estimateRevision.create({
      data: {
        organizationId: orgId,
        locationId,
        workOrderId: wo!.id,
        revisionNumber,
        status: "PRESENTED",
        documentKind: kind,
        ...(kind === "CHANGE_ORDER" ? { changeOrderNumber: revisionNumber - 1 } : {}),
        summaryNote: kind === "CHANGE_ORDER" ? "Rotors scored." : null,
        currency: "USD",
        subtotalMinor: 10000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 10000n,
        presentedAt: new Date(),
        createdByUserId: userId,
      },
    });

  const baseline = await makeRevision(1, "BASELINE");
  const changeOrder = await makeRevision(2, "CHANGE_ORDER");

  const makeLink = async (revisionId: string) =>
    dbModule.db.authorizationLink.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        estimateRevisionId: revisionId,
        token: randomUUID().replace(/-/g, ""),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

  const coLink = await makeLink(changeOrder.id);

  return {
    orgId,
    workOrderId: wo!.id,
    baselineRevisionId: baseline.id,
    changeOrderRevisionId: changeOrder.id,
    coLinkToken: coLink.token,
    coLinkId: coLink.id,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set([
          "work_orders.read",
          "work_orders.write",
          "estimates.present",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

async function configureLocalStorage() {
  await dbModule.db.connectorInstance.create({
    data: {
      id: randomUUID(),
      scope: "platform",
      capability: "file_storage",
      adapterKey: "local",
      displayName: "Test local storage",
      configuration: { basePath: storageBasePath },
      status: "active",
    },
  });
}

beforeAll(async () => {
  if (!RUN) return;
  dbModule = await import("@/db/client");
  storageBasePath = await mkdtemp(join(tmpdir(), "shopos-attachments-"));
}, 30_000);

afterAll(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
  await dbModule.db.$disconnect();
  await rm(storageBasePath, { recursive: true, force: true });
});

beforeEach(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
  await configureLocalStorage();
});

describe("document evidence attachments (#132)", { skip: shouldSkip }, () => {
  it("serves an attachment linked to the token's document", async () => {
    const {
      uploadAttachment,
      listAttachmentsForAuthorizationLink,
      downloadAttachmentForAuthorizationLink,
    } = await import("@/modules/work-orders/attachment-service");
    const seed = await seedPresentedDocument();

    const { attachmentId } = await uploadAttachment({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      estimateRevisionId: seed.changeOrderRevisionId,
      fileName: "scored-rotor.png",
      contentType: "image/png",
      body: PNG_BYTES,
    });

    const listed = await listAttachmentsForAuthorizationLink(dbModule.db, seed.coLinkToken);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(attachmentId);

    const file = await downloadAttachmentForAuthorizationLink(dbModule.db, {
      token: seed.coLinkToken,
      attachmentId,
    });
    expect(file.contentType).toBe("image/png");
    expect(file.body).toEqual(PNG_BYTES);
  });

  it("never exposes work-order-wide or other-document attachments through a link", async () => {
    const {
      uploadAttachment,
      listAttachmentsForAuthorizationLink,
      downloadAttachmentForAuthorizationLink,
    } = await import("@/modules/work-orders/attachment-service");
    const seed = await seedPresentedDocument();
    const context = seed.context();

    const workOrderWide = await uploadAttachment({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      fileName: "internal-notes.png",
      contentType: "image/png",
      body: PNG_BYTES,
    });
    const baselineOnly = await uploadAttachment({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      estimateRevisionId: seed.baselineRevisionId,
      fileName: "baseline-photo.png",
      contentType: "image/png",
      body: PNG_BYTES,
    });

    const listed = await listAttachmentsForAuthorizationLink(dbModule.db, seed.coLinkToken);
    expect(listed).toHaveLength(0);
    await expect(
      downloadAttachmentForAuthorizationLink(dbModule.db, {
        token: seed.coLinkToken,
        attachmentId: workOrderWide.attachmentId,
      }),
    ).rejects.toMatchObject({ reason: "attachment_not_found" });
    await expect(
      downloadAttachmentForAuthorizationLink(dbModule.db, {
        token: seed.coLinkToken,
        attachmentId: baselineOnly.attachmentId,
      }),
    ).rejects.toMatchObject({ reason: "attachment_not_found" });
  });

  it("stops serving once the link is used, revoked, or expired", async () => {
    const { uploadAttachment, listAttachmentsForAuthorizationLink } =
      await import("@/modules/work-orders/attachment-service");
    const seed = await seedPresentedDocument();
    await uploadAttachment({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      estimateRevisionId: seed.changeOrderRevisionId,
      fileName: "rotor.png",
      contentType: "image/png",
      body: PNG_BYTES,
    });

    await dbModule.db.authorizationLink.update({
      where: { id: seed.coLinkId },
      data: { usedAt: new Date() },
    });
    await expect(
      listAttachmentsForAuthorizationLink(dbModule.db, seed.coLinkToken),
    ).rejects.toMatchObject({ reason: "link_used" });

    await dbModule.db.authorizationLink.update({
      where: { id: seed.coLinkId },
      data: { usedAt: null, revokedAt: new Date() },
    });
    await expect(
      listAttachmentsForAuthorizationLink(dbModule.db, seed.coLinkToken),
    ).rejects.toMatchObject({ reason: "link_revoked" });

    await dbModule.db.authorizationLink.update({
      where: { id: seed.coLinkId },
      data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      listAttachmentsForAuthorizationLink(dbModule.db, seed.coLinkToken),
    ).rejects.toMatchObject({ reason: "link_expired" });
  });

  it("rejects a document upload referencing another work order's revision", async () => {
    const { uploadAttachment } = await import("@/modules/work-orders/attachment-service");
    const seedA = await seedPresentedDocument();
    const seedB = await seedPresentedDocument();

    await expect(
      uploadAttachment({
        db: dbModule.db,
        context: seedA.context(),
        workOrderId: seedA.workOrderId,
        estimateRevisionId: seedB.changeOrderRevisionId,
        fileName: "cross.png",
        contentType: "image/png",
        body: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ reason: "revision_not_found" });
  });

  it("the public payload lists only image evidence", async () => {
    const { uploadAttachment } = await import("@/modules/work-orders/attachment-service");
    const { GET } = await import("@/app/api/public/authorize/[token]/route");
    const seed = await seedPresentedDocument();

    await uploadAttachment({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      estimateRevisionId: seed.changeOrderRevisionId,
      fileName: "rotor.png",
      contentType: "image/png",
      body: PNG_BYTES,
    });
    await uploadAttachment({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      estimateRevisionId: seed.changeOrderRevisionId,
      fileName: "notes.txt",
      contentType: "text/plain",
      body: new TextEncoder().encode("internal notes"),
    });

    const response = await GET(new Request("http://localhost/irrelevant"), {
      params: Promise.resolve({ token: seed.coLinkToken }),
    });
    const data = (await response.json()) as { attachments: Array<{ fileName: string }> };
    expect(data.attachments).toHaveLength(1);
    expect(data.attachments[0]?.fileName).toBe("rotor.png");
  });
});
