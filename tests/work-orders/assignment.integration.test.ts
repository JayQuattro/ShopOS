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

async function seed() {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const techId = randomUUID();
  const outsiderId = randomUUID();
  const membershipId = randomUUID();
  const techMembershipId = randomUUID();
  const roleId = randomUUID();
  const techRoleId = randomUUID();
  const customerId = randomUUID();

  const techPermissions = ["work_orders.read"];
  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Assign Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `org-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `m-${userId.slice(0, 8)}@example.test`, displayName: "Manager" },
    }),
    dbModule.db.user.create({
      data: {
        id: techId,
        email: `t-${techId.slice(0, 8)}@example.test`,
        displayName: "Taylor Tech",
      },
    }),
    dbModule.db.user.create({
      data: {
        id: outsiderId,
        email: `o-${outsiderId.slice(0, 8)}@example.test`,
        displayName: "Outsider",
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
    dbModule.db.organizationMembership.create({
      data: {
        id: techMembershipId,
        organizationId: orgId,
        userId: techId,
        organizationWideLocationAccess: true,
      },
    }),
    // The outsider belongs to a DIFFERENT organization.
    dbModule.db.organizationMembership.create({
      data: {
        id: randomUUID(),
        organizationId: otherOrgId,
        userId: outsiderId,
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
    dbModule.db.role.create({
      data: {
        id: techRoleId,
        organizationId: orgId,
        key: "tech",
        name: "Technician",
        permissions: techPermissions,
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.membershipRole.create({
      data: { organizationId: orgId, membershipId: techMembershipId, roleId: techRoleId },
    }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Assign Customer",
      },
    }),
  ]);

  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: orgId,
      locationId,
      customerId,
      number: "RO-8001",
      customerConcern: "Assign me",
    },
  });

  return {
    orgId,
    workOrderId: wo.id,
    techId,
    outsiderId,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set(["work_orders.read", "work_orders.write"] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("work-order technician assignment (#133)", { skip: shouldSkip }, () => {
  it("assigns and re-assigns a technician with activity history", async () => {
    const { assignTechnician, unassignTechnician } =
      await import("@/modules/work-orders/assignment-service");
    const seedData = await seed();

    await assignTechnician({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      userId: seedData.techId,
    });
    let wo = await dbModule.db.workOrder.findUnique({
      where: { id: seedData.workOrderId },
      include: { assignedTechnician: true },
    });
    expect(wo?.assignedTechnician?.displayName).toBe("Taylor Tech");

    const assigned = await dbModule.db.activityEvent.findFirst({
      where: { workOrderId: seedData.workOrderId, eventType: "work_order.assigned" },
    });
    expect(assigned?.summary).toContain("Taylor Tech");

    await unassignTechnician({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    wo = await dbModule.db.workOrder.findUnique({
      where: { id: seedData.workOrderId },
      include: { assignedTechnician: true },
    });
    expect(wo?.assignedTechnician).toBeNull();

    const unassigned = await dbModule.db.activityEvent.findFirst({
      where: { workOrderId: seedData.workOrderId, eventType: "work_order.unassigned" },
    });
    expect(unassigned).not.toBeNull();
  });

  it("rejects a user who is not an active member of the organization", async () => {
    const { assignTechnician } = await import("@/modules/work-orders/assignment-service");
    const seedData = await seed();

    await expect(
      assignTechnician({
        db: dbModule.db,
        context: seedData.context(),
        workOrderId: seedData.workOrderId,
        userId: seedData.outsiderId,
      }),
    ).rejects.toMatchObject({ reason: "technician_not_a_member" });

    const wo = await dbModule.db.workOrder.findUnique({
      where: { id: seedData.workOrderId },
    });
    expect(wo?.assignedTechnicianUserId).toBeNull();
  });

  it("denies assignment without work_orders.write", async () => {
    const { assignTechnician } = await import("@/modules/work-orders/assignment-service");
    const seedData = await seed();
    const read_only = {
      ...seedData.context(),
      permissions: new Set(["work_orders.read"] as const),
    };

    await expect(
      assignTechnician({
        db: dbModule.db,
        context: read_only,
        workOrderId: seedData.workOrderId,
        userId: seedData.techId,
      }),
    ).rejects.toThrow();
  });

  it("denies assignment on another organization's work order", async () => {
    const { assignTechnician } = await import("@/modules/work-orders/assignment-service");
    const seedA = await seed();
    const seedB = await seed();

    await expect(
      assignTechnician({
        db: dbModule.db,
        context: seedA.context(),
        workOrderId: seedB.workOrderId,
        userId: seedA.techId,
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
  });

  it("lists only members with work-order read access as assignable", async () => {
    const { listAssignableTechnicians } = await import("@/modules/work-orders/assignment-service");
    const seedData = await seed();

    // A member with no roles has no permissions and must not be assignable.
    const noRoleUserId = randomUUID();
    const noRoleMembershipId = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: noRoleUserId,
        email: `n-${noRoleUserId.slice(0, 8)}@example.test`,
        displayName: "No Role",
      },
    });
    await dbModule.db.organizationMembership.create({
      data: {
        id: noRoleMembershipId,
        organizationId: seedData.orgId,
        userId: noRoleUserId,
        organizationWideLocationAccess: true,
      },
    });

    const technicians = await listAssignableTechnicians({
      db: dbModule.db,
      context: seedData.context(),
    });
    const names = technicians.map((t) => t.displayName);
    // The owner role carries work_orders.read, so both the manager and the
    // technician are assignable; the role-less member is not.
    expect(names).toContain("Taylor Tech");
    expect(names).toContain("Manager");
    expect(names).not.toContain("No Role");
  });
});
