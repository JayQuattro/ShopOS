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
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Keys Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `other-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `k-${userId.slice(0, 8)}@example.test`,
        displayName: "Key Keeper",
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
        permissions: ["work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Key Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-5501",
        customerConcern: "Key tracking test",
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
      permissions: new Set<string>(permissions ?? ["work_orders.read", "work_orders.write"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, workOrderId, customerId, locationId, context };
}

describe("key tracking (#178)", { skip: shouldSkip }, () => {
  it("sets and clears the key tag and location through the repository", async () => {
    const { WorkOrderRepository, WorkOrderNotFound } =
      await import("@/modules/work-orders/work-order-repository");
    const seed = await seedShop();
    const repo = new WorkOrderRepository({ db: dbModule.db, context: seed.context() });

    await repo.update(seed.workOrderId, { keyTag: "K-77", keyLocation: "Hook 3" });
    let detail = await repo.findById(seed.workOrderId);
    expect(detail?.keyTag).toBe("K-77");
    expect(detail?.keyLocation).toBe("Hook 3");

    // Clearing passes explicit nulls — "returned to customer".
    await repo.update(seed.workOrderId, { keyTag: null, keyLocation: null });
    detail = await repo.findById(seed.workOrderId);
    expect(detail?.keyTag).toBeNull();
    expect(detail?.keyLocation).toBeNull();

    // Unrelated fields still update alongside.
    await repo.update(seed.workOrderId, {
      keyTag: "K-78",
      keyLocation: "With technician",
      customerConcern: "Updated concern",
    });
    detail = await repo.findById(seed.workOrderId);
    expect(detail?.keyTag).toBe("K-78");
    expect(detail?.customerConcern).toBe("Updated concern");
    expect(await repo.list()).toBeDefined();

    // Unknown ids still raise not-found, not silent success.
    await expect(repo.update(randomUUID(), { keyTag: "K-1" })).rejects.toThrowError(
      WorkOrderNotFound,
    );
  });

  it("never mutates another organization's key info", async () => {
    const { WorkOrderRepository, WorkOrderNotFound } =
      await import("@/modules/work-orders/work-order-repository");
    const seed = await seedShop();

    const otherContext = {
      ...seed.context(),
      organizationId: seed.otherOrgId,
    } as import("@/modules/tenancy/policy").TenantContext;
    const otherRepo = new WorkOrderRepository({ db: dbModule.db, context: otherContext });

    await expect(
      otherRepo.update(seed.workOrderId, { keyTag: "EVIL-1", keyLocation: "stolen" }),
    ).rejects.toThrowError(WorkOrderNotFound);

    const ownRepo = new WorkOrderRepository({ db: dbModule.db, context: seed.context() });
    const detail = await ownRepo.findById(seed.workOrderId);
    expect(detail?.keyTag).toBeNull();
  });

  it("requires work-order write permission to edit key info", async () => {
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();

    const readerRepo = new WorkOrderRepository({
      db: dbModule.db,
      context: seed.context(["work_orders.read"]),
    });
    await expect(readerRepo.update(seed.workOrderId, { keyTag: "K-1" })).rejects.toThrowError(
      TenantAccessDenied,
    );

    const detail = await readerRepo.findById(seed.workOrderId);
    expect(detail?.keyTag).toBeNull();
  });
});
