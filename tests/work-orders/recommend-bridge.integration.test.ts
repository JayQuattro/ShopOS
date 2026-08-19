import { execFileSync } from "node:child_process";
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

beforeAll(async () => {
  if (!RUN) return;
  dbModule = await import("@/db/client");
  await resetTestDatabase(dbModule.db);
}, 30_000);

afterAll(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
  await dbModule.db.$disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
});

async function seedShop() {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Bridge Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `o-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `rb-${userId.slice(0, 8)}@example.test`, displayName: "Advisor" },
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
        permissions: ["work_orders.write", "work_orders.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Bridge Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-RB1",
        customerConcern: "bridge test",
        status: "IN_PROGRESS",
      },
    }),
  ]);

  const context = (permissions?: readonly string[]) =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set<string>(permissions ?? ["work_orders.write", "work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, locationId, workOrderId, context };
}

async function seedBaseline(orgId: string, locationId: string, workOrderId: string) {
  await dbModule.db.estimateRevision.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      locationId,
      workOrderId,
      revisionNumber: 1,
      documentKind: "BASELINE",
      status: "PRESENTED",
      currency: "USD",
      subtotalMinor: 0n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 0n,
      presentedAt: new Date(),
    },
  });
}

async function seedInspectionWithReplace(
  orgId: string,
  locationId: string,
  workOrderId: string,
  withPhoto: boolean,
) {
  const inspectionId = randomUUID();
  await dbModule.db.inspection.create({
    data: { id: inspectionId, organizationId: orgId, locationId, workOrderId, title: "Walkaround" },
  });
  await dbModule.db.inspectionItem.createMany({
    data: [
      {
        id: randomUUID(),
        organizationId: orgId,
        inspectionId,
        position: 1,
        zone: "Brakes",
        component: "Front pads & rotors",
        condition: "REPLACE",
        note: "Scored rotors",
        recommended: true,
      },
      {
        id: randomUUID(),
        organizationId: orgId,
        inspectionId,
        position: 2,
        zone: "Tires",
        component: "Tread depth",
        condition: "OK",
      },
    ],
  });

  let photoId: string | null = null;
  if (withPhoto) {
    photoId = randomUUID();
    await dbModule.db.workOrderAttachment.create({
      data: {
        id: photoId,
        organizationId: orgId,
        workOrderId,
        inspectionItemId: (await dbModule.db.inspectionItem.findFirst({
          where: { inspectionId, position: 1 },
        }))!.id,
        objectKey: `work-orders/${workOrderId}/${photoId}/rotor.jpg`,
        fileName: "rotor.jpg",
        contentType: "image/jpeg",
        sizeBytes: 1024,
      },
    });
  }

  const item = await dbModule.db.inspectionItem.findFirst({
    where: { inspectionId, position: 1 },
    select: { id: true },
  });
  return { inspectionId, itemId: item!.id, photoId };
}

describe("recommend → estimate bridge (#206)", { skip: shouldSkip }, () => {
  it("turns a REPLACE row into a change-order line carrying its photos", async () => {
    const bridge = await import("@/modules/work-orders/recommend-bridge-service");
    const seed = await seedShop();
    await seedBaseline(seed.orgId, seed.locationId, seed.workOrderId);
    const { itemId, photoId } = await seedInspectionWithReplace(
      seed.orgId,
      seed.locationId,
      seed.workOrderId,
      true,
    );

    const result = await bridge.recommendInspectionItemToEstimate({
      db: dbModule.db,
      context: seed.context(),
      inspectionItemId: itemId,
    });

    // The change-order line names the component and zone.
    const line = await dbModule.db.estimateLine.findUnique({
      where: { id: result.lineId },
      select: { description: true, estimateRevisionId: true, kind: true },
    });
    expect(line?.description).toBe("Recommended from inspection — Brakes: Front pads & rotors");
    expect(line?.kind).toBe("PART");
    expect(line?.estimateRevisionId).toBe(result.revisionId);

    // The item's photo anchored to the new estimate line and its revision —
    // the authorization page will show it beside the price.
    const photo = await dbModule.db.workOrderAttachment.findUnique({
      where: { id: photoId! },
      select: { estimateLineId: true, estimateRevisionId: true },
    });
    expect(photo?.estimateLineId).toBe(result.lineId);
    expect(photo?.estimateRevisionId).toBe(result.revisionId);

    // Activity recorded on the work order.
    const events = await dbModule.db.activityEvent.findMany({
      where: { workOrderId: seed.workOrderId, eventType: "inspection.recommended" },
    });
    expect(events).toHaveLength(1);
  });

  it("refuses non-REPLACE rows, foreign items, and unauthorized callers", async () => {
    const bridge = await import("@/modules/work-orders/recommend-bridge-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();
    const { inspectionId, itemId } = await seedInspectionWithReplace(
      seed.orgId,
      seed.locationId,
      seed.workOrderId,
      false,
    );

    // A non-REPLACE row is not a recommendation.
    const okItem = await dbModule.db.inspectionItem.findFirst({
      where: { inspectionId, position: 2 },
      select: { id: true },
    });
    await expect(
      bridge.recommendInspectionItemToEstimate({
        db: dbModule.db,
        context: seed.context(),
        inspectionItemId: okItem!.id,
      }),
    ).rejects.toMatchObject({ reason: "item_not_recommended" });

    // Foreign org sees nothing.
    await expect(
      bridge.recommendInspectionItemToEstimate({
        db: dbModule.db,
        context: {
          ...seed.context(),
          organizationId: seed.otherOrgId,
        } as import("@/modules/tenancy/policy").TenantContext,
        inspectionItemId: itemId,
      }),
    ).rejects.toMatchObject({ reason: "item_not_found" });

    // Write permission required.
    await expect(
      bridge.recommendInspectionItemToEstimate({
        db: dbModule.db,
        context: seed.context(["work_orders.read"]),
        inspectionItemId: itemId,
      }),
    ).rejects.toThrowError(TenantAccessDenied);

    expect(
      await dbModule.db.estimateRevision.count({
        where: { workOrderId: seed.workOrderId, documentKind: "CHANGE_ORDER" },
      }),
    ).toBe(0);
  });
});
