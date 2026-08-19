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
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Inspection Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `o-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `dv-${userId.slice(0, 8)}@example.test`,
        displayName: "Inspector",
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
        permissions: ["work_orders.write", "work_orders.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Inspection Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-DVI1",
        customerConcern: "dvi test",
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

  return { orgId, otherOrgId, workOrderId, context };
}

async function seedTemplate(orgId: string) {
  const templateId = randomUUID();
  await dbModule.db.inspectionTemplate.create({
    data: { id: templateId, organizationId: orgId, name: "Full walkaround" },
  });
  await dbModule.db.inspectionTemplateItem.createMany({
    data: [
      {
        id: randomUUID(),
        organizationId: orgId,
        inspectionTemplateId: templateId,
        position: 1,
        zone: "Brakes",
        component: "Front pads & rotors",
      },
      {
        id: randomUUID(),
        organizationId: orgId,
        inspectionTemplateId: templateId,
        position: 2,
        zone: "Brakes",
        component: "Rear pads",
      },
      {
        id: randomUUID(),
        organizationId: orgId,
        inspectionTemplateId: templateId,
        position: 3,
        zone: "Tires",
        component: "Tread depth all four",
      },
    ],
  });
  return templateId;
}

describe("digital vehicle inspections (#203 scaffold)", { skip: shouldSkip }, () => {
  it("creates from a template with positioned items and records conditions", async () => {
    const inspections = await import("@/modules/work-orders/inspection-service");
    const seed = await seedShop();
    const templateId = await seedTemplate(seed.orgId);

    const { inspectionId } = await inspections.createInspection({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      title: "Walkaround — 2021 Civic",
      templateId,
    });

    const items = await dbModule.db.inspectionItem.findMany({
      where: { inspectionId },
      orderBy: { position: "asc" },
      select: { id: true, component: true, condition: true, recommended: true },
    });
    expect(items.map((item) => item.component)).toEqual([
      "Front pads & rotors",
      "Rear pads",
      "Tread depth all four",
    ]);
    expect(items.every((item) => item.condition === "OK" && !item.recommended)).toBe(true);

    // The tech's verdicts: front brakes need replacement, rear watch.
    await inspections.setInspectionItemCondition({
      db: dbModule.db,
      context: seed.context(),
      itemId: items[0]!.id,
      condition: "REPLACE",
      note: "Scored rotors, 2mm pads — photos attached",
    });
    await inspections.setInspectionItemCondition({
      db: dbModule.db,
      context: seed.context(),
      itemId: items[1]!.id,
      condition: "WATCH",
    });

    // Ad-hoc item appends below template items.
    const { itemId } = await inspections.addInspectionItem({
      db: dbModule.db,
      context: seed.context(),
      inspectionId,
      zone: "Fluids",
      component: "Brake fluid moisture",
    });
    expect(itemId).toBeTruthy();

    const recommended = await inspections.listRecommendedItems({
      db: dbModule.db,
      context: seed.context(),
      inspectionId,
    });
    expect(recommended.map((item) => item.component)).toEqual(["Front pads & rotors"]);
    expect(recommended[0]?.note).toContain("Scored");

    const positions = await dbModule.db.inspectionItem.findMany({
      where: { inspectionId },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    expect(positions.map((item) => item.position)).toEqual([1, 2, 3, 4]);
  });

  it("completes, freezes, and mints a stable share token", async () => {
    const inspections = await import("@/modules/work-orders/inspection-service");
    const seed = await seedShop();

    const { inspectionId } = await inspections.createInspection({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      title: "Quick check",
    });

    // Drafts cannot be shared; completed ones freeze.
    await expect(
      inspections.shareInspection({ db: dbModule.db, context: seed.context(), inspectionId }),
    ).rejects.toMatchObject({ reason: "not_draft" });

    // Add the row while still a draft, then freeze.
    const { itemId } = await inspections.addInspectionItem({
      db: dbModule.db,
      context: seed.context(),
      inspectionId,
      component: "Wiper blades",
    });

    await inspections.completeInspection({
      db: dbModule.db,
      context: seed.context(),
      inspectionId,
    });
    const row = await dbModule.db.inspection.findUnique({
      where: { id: inspectionId },
      select: { status: true, completedAt: true },
    });
    expect(row?.status).toBe("completed");
    expect(row?.completedAt).not.toBeNull();

    // Completed inspections refuse condition edits.
    await expect(
      inspections.setInspectionItemCondition({
        db: dbModule.db,
        context: seed.context(),
        itemId,
        condition: "REPLACE",
      }),
    ).rejects.toMatchObject({ reason: "not_draft" });

    const first = await inspections.shareInspection({
      db: dbModule.db,
      context: seed.context(),
      inspectionId,
    });
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    // Sharing twice returns the same token — links in the wild keep working.
    const second = await inspections.shareInspection({
      db: dbModule.db,
      context: seed.context(),
      inspectionId,
    });
    expect(second.token).toBe(first.token);

    // Completion wrote an activity event on the work order.
    const events = await dbModule.db.activityEvent.findMany({
      where: { workOrderId: seed.workOrderId, eventType: "inspection.completed" },
    });
    expect(events).toHaveLength(1);
  });

  it("scopes everything to the organization", async () => {
    const inspections = await import("@/modules/work-orders/inspection-service");
    const seed = await seedShop();
    const templateId = await seedTemplate(seed.orgId);

    const { inspectionId } = await inspections.createInspection({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      title: "Mine",
      templateId,
    });

    // Foreign org: template invisible, inspection invisible, item invisible.
    const foreignContext = {
      ...seed.context(),
      organizationId: seed.otherOrgId,
    } as import("@/modules/tenancy/policy").TenantContext;

    await expect(
      inspections.createInspection({
        db: dbModule.db,
        context: foreignContext,
        workOrderId: seed.workOrderId,
        title: "Theirs",
        templateId,
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });

    const item = await dbModule.db.inspectionItem.findFirst({ where: { inspectionId } });
    await expect(
      inspections.setInspectionItemCondition({
        db: dbModule.db,
        context: foreignContext,
        itemId: item!.id,
        condition: "REPLACE",
      }),
    ).rejects.toMatchObject({ reason: "item_not_found" });
    await expect(
      inspections.shareInspection({ db: dbModule.db, context: foreignContext, inspectionId }),
    ).rejects.toMatchObject({ reason: "inspection_not_found" });
    await expect(
      inspections.listRecommendedItems({ db: dbModule.db, context: foreignContext, inspectionId }),
    ).resolves.toEqual([]);
  });
});
