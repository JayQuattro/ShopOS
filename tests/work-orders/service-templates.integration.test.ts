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
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Template Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `org-${otherOrgId.slice(0, 8)}`, name: "Other Template Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `t-${userId.slice(0, 8)}@example.test`,
        displayName: "Template User",
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
        displayName: "Template Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-1101",
        customerConcern: "Template me",
      },
    }),
  ]);

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  return {
    orgId,
    workOrderId,
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

describe("service templates (#139)", { skip: shouldSkip }, () => {
  it("creates, lists, and deletes templates with org-scoped unique names", async () => {
    const { createServiceTemplate, listServiceTemplates, deleteServiceTemplate } =
      await import("@/modules/work-orders/service-template-service");
    const seedData = await seed();

    await createServiceTemplate({
      db: dbModule.db,
      context: seedData.context(),
      name: "Front brake job",
      lines: [
        {
          kind: "LABOR",
          serviceGroupKey: "brakes",
          description: "Replace front pads",
          quantityMilli: 1500,
          unitPriceMinor: 12000,
          taxable: false,
          taxRateBasisPoints: 0,
        },
      ],
      tasks: [{ title: "Front brake pads" }, { title: "Rotor thickness" }],
    });
    await expect(
      createServiceTemplate({
        db: dbModule.db,
        context: seedData.context(),
        name: "Front brake job",
        lines: [],
        tasks: [{ title: "Different content" }],
      }),
    ).rejects.toMatchObject({ reason: "duplicate_name" });
    await expect(
      createServiceTemplate({
        db: dbModule.db,
        context: seedData.context(),
        name: "Empty",
        lines: [],
        tasks: [],
      }),
    ).rejects.toMatchObject({ reason: "empty_template" });

    let templates = await listServiceTemplates({ db: dbModule.db, context: seedData.context() });
    expect(templates).toHaveLength(1);
    expect(templates[0]?.lines).toHaveLength(1);
    expect(templates[0]?.tasks).toHaveLength(2);

    await deleteServiceTemplate({
      db: dbModule.db,
      context: seedData.context(),
      templateId: templates[0]!.id,
    });
    templates = await listServiceTemplates({ db: dbModule.db, context: seedData.context() });
    expect(templates).toHaveLength(0);
  });

  it("applies a template: lines priced into a (new) draft revision, tasks appended", async () => {
    const { createServiceTemplate, applyServiceTemplateToWorkOrder } =
      await import("@/modules/work-orders/service-template-service");
    const seedData = await seed();

    const { templateId } = await createServiceTemplate({
      db: dbModule.db,
      context: seedData.context(),
      name: "Oil change",
      lines: [
        {
          kind: "PART",
          serviceGroupKey: "oil",
          description: "Synthetic oil 5W-30",
          quantityMilli: 5000,
          unitPriceMinor: 9000,
          taxable: false,
          taxRateBasisPoints: 0,
        },
        {
          kind: "LABOR",
          serviceGroupKey: "oil",
          description: "Change oil and filter",
          quantityMilli: 500,
          unitPriceMinor: 6000,
          taxable: false,
          taxRateBasisPoints: 0,
        },
      ],
      tasks: [{ title: "Check tire pressure" }],
    });

    const result = await applyServiceTemplateToWorkOrder({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      templateId,
    });
    expect(result.linesAdded).toBe(2);
    expect(result.tasksAdded).toBe(1);
    expect(result.revisionId).not.toBeNull();

    const revision = await dbModule.db.estimateRevision.findUnique({
      where: { id: result.revisionId! },
      include: { lines: true },
    });
    expect(revision?.status).toBe("DRAFT");
    expect(revision?.documentKind).toBe("BASELINE");
    expect(revision?.currency).toBe("USD");
    expect(revision?.lines).toHaveLength(2);
    // Money kernel priced the lines: 5L × $90 + 0.5h × $60 = $480.00
    expect(revision?.totalMinor).toBe(48000n);

    const tasks = await dbModule.db.workOrderTask.findMany({
      where: { workOrderId: seedData.workOrderId },
    });
    expect(tasks.map((task) => task.title)).toEqual(["Check tire pressure"]);

    const activity = await dbModule.db.activityEvent.findFirst({
      where: { workOrderId: seedData.workOrderId, eventType: "template.applied" },
    });
    expect(activity?.summary).toContain("Oil change");
  });

  it("appends to an existing draft instead of creating a new revision", async () => {
    const { createServiceTemplate, applyServiceTemplateToWorkOrder } =
      await import("@/modules/work-orders/service-template-service");
    const { createDraftRevision, addLine } = await import("@/modules/estimates/estimate-service");
    const seedData = await seed();
    const context = seedData.context();

    const { revisionId } = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      currency: "USD",
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId,
      kind: "FEE",
      serviceGroupKey: "shop",
      description: "Shop supplies",
      quantityMilli: 1000,
      unitPriceMinor: 500,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 1,
    });

    const { templateId } = await createServiceTemplate({
      db: dbModule.db,
      context,
      name: "Rotation",
      lines: [
        {
          kind: "LABOR",
          serviceGroupKey: "tires",
          description: "Tire rotation",
          quantityMilli: 500,
          unitPriceMinor: 3000,
          taxable: false,
          taxRateBasisPoints: 0,
        },
      ],
      tasks: [],
    });

    const result = await applyServiceTemplateToWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      templateId,
    });
    expect(result.revisionId).toBe(revisionId);

    const revisions = await dbModule.db.estimateRevision.findMany({
      where: { workOrderId: seedData.workOrderId },
    });
    expect(revisions).toHaveLength(1);

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: revisionId },
      orderBy: { position: "asc" },
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]?.position).toBe(2);
  });

  it("keeps templates tenant-scoped", async () => {
    const { createServiceTemplate, applyServiceTemplateToWorkOrder, listServiceTemplates } =
      await import("@/modules/work-orders/service-template-service");
    const seedA = await seed();
    const seedB = await seed();

    const { templateId } = await createServiceTemplate({
      db: dbModule.db,
      context: seedA.context(),
      name: "Shared name",
      tasks: [{ title: "Look it over" }],
      lines: [],
    });

    await expect(
      applyServiceTemplateToWorkOrder({
        db: dbModule.db,
        context: seedB.context(),
        workOrderId: seedB.workOrderId,
        templateId,
      }),
    ).rejects.toMatchObject({ reason: "template_not_found" });

    // The same template name is fine in another org; lists don't bleed.
    await createServiceTemplate({
      db: dbModule.db,
      context: seedB.context(),
      name: "Shared name",
      tasks: [{ title: "Check it" }],
      lines: [],
    });
    const listA = await listServiceTemplates({ db: dbModule.db, context: seedA.context() });
    const listB = await listServiceTemplates({ db: dbModule.db, context: seedB.context() });
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
  });
});
