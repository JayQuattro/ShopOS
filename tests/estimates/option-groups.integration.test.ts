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
env.AUTH_EMAIL_DELIVERY = "console";

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

async function seedWorkOrder() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Opt Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `u-${userId.slice(0, 8)}@example.test`, displayName: "Opt User" },
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
        permissions: [
          "work_orders.read",
          "work_orders.write",
          "estimates.present",
          "authorizations.record",
          "invoices.issue",
        ],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Opt Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Opt Car",
        category: "automobile",
      },
    }),
  ]);

  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: orgId,
      locationId,
      customerId,
      assetId,
      number: "RO-3001",
      customerConcern: "Oil change",
    },
  });

  return {
    orgId,
    workOrderId: wo.id,
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
          "authorizations.record",
          "invoices.issue",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("estimate option groups", { skip: shouldSkip }, () => {
  it("records a pick-one choice: chosen option approved, siblings auto-declined", async () => {
    const { createDraftRevision, addLine, presentRevision } =
      await import("@/modules/estimates/estimate-service");
    const { recordAuthorization, getAuthorizationState } =
      await import("@/modules/estimates/authorization-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });

    await addLine({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      kind: "LABOR",
      serviceGroupKey: "oil-change",
      description: "Regular oil change",
      quantityMilli: 1000,
      unitPriceMinor: 4995,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 1,
      optionGroupKey: "oil-change-package",
      optionGroupLabel: "Oil change package",
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      kind: "LABOR",
      serviceGroupKey: "oil-change",
      description: "Premium oil change",
      quantityMilli: 1000,
      unitPriceMinor: 8995,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 2,
      optionGroupKey: "oil-change-package",
      optionGroupLabel: "Oil change package",
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      kind: "FEE",
      serviceGroupKey: "fees",
      description: "Shop supply fee",
      quantityMilli: 1000,
      unitPriceMinor: 500,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 3,
    });

    await presentRevision({ db: dbModule.db, context, revisionId: rev.revisionId });

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: rev.revisionId },
      orderBy: { position: "asc" },
      select: { id: true, description: true },
    });
    const premium = lines.find((l) => l.description === "Premium oil change");
    const fee = lines.find((l) => l.description === "Shop supply fee");

    // The customer picks premium; only the chosen line is submitted.
    await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      method: "IN_PERSON",
      providedByName: "Opt Customer",
      decisions: [
        { estimateLineId: premium!.id, decision: "APPROVED" },
        { estimateLineId: fee!.id, decision: "APPROVED" },
      ],
    });

    const state = await getAuthorizationState({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
    });
    const byDescription = new Map(state.lines.map((l) => [l.description, l]));
    expect(byDescription.get("Premium oil change")?.decision).toBe("APPROVED");
    expect(byDescription.get("Regular oil change")?.decision).toBe("DECLINED");
    expect(byDescription.get("Shop supply fee")?.decision).toBe("APPROVED");
    expect(byDescription.get("Regular oil change")?.optionGroupLabel).toBe("Oil change package");
  });

  it("refuses two approvals inside one option group", async () => {
    const { createDraftRevision, addLine, presentRevision } =
      await import("@/modules/estimates/estimate-service");
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    for (const [position, description] of [
      [1, "Option A"],
      [2, "Option B"],
    ] as const) {
      await addLine({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        kind: "LABOR",
        serviceGroupKey: "choice",
        description,
        quantityMilli: 1000,
        unitPriceMinor: 1000,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position,
        optionGroupKey: "the-choice",
        optionGroupLabel: "The choice",
      });
    }
    await presentRevision({ db: dbModule.db, context, revisionId: rev.revisionId });

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: rev.revisionId },
      select: { id: true },
    });

    await expect(
      recordAuthorization({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        method: "PHONE",
        providedByName: "Opt Customer",
        decisions: lines.map((line) => ({ estimateLineId: line.id, decision: "APPROVED" })),
      }),
    ).rejects.toMatchObject({ reason: "conflicting_options" });

    // Nothing was recorded — the transaction rolled back.
    const decisions = await dbModule.db.authorizationDecision.count();
    expect(decisions).toBe(0);
  });

  it("requires key and label together on addLine", async () => {
    const { createDraftRevision, addLine } = await import("@/modules/estimates/estimate-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });

    await expect(
      addLine({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        kind: "LABOR",
        serviceGroupKey: "choice",
        description: "Lone option",
        quantityMilli: 1000,
        unitPriceMinor: 1000,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position: 1,
        optionGroupKey: "orphan",
      }),
    ).rejects.toMatchObject({ reason: "invalid_option_group" });
  });

  it("reorders lines across job groups and reassigns positions", async () => {
    const { createDraftRevision, addLine, reorderLines } =
      await import("@/modules/estimates/estimate-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    for (const [position, description, group] of [
      [1, "Tune-up line", "tune-up"],
      [2, "Brake rotor", "front-brakes"],
      [3, "Brake pads", "front-brakes"],
    ] as const) {
      await addLine({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        kind: "PART",
        serviceGroupKey: group,
        description,
        quantityMilli: 1000,
        unitPriceMinor: 1000,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position,
      });
    }

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: rev.revisionId },
      select: { id: true, description: true },
    });
    const byDescription = new Map(lines.map((l) => [l.description, l.id]));

    // Drag "Brake pads" above "Brake rotor" and move the tune-up line into
    // the brakes job in the same save.
    await reorderLines({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      items: [
        { lineId: byDescription.get("Brake pads")!, serviceGroupKey: "front-brakes" },
        { lineId: byDescription.get("Brake rotor")!, serviceGroupKey: "front-brakes" },
        { lineId: byDescription.get("Tune-up line")!, serviceGroupKey: "front-brakes" },
      ],
    });

    const after = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: rev.revisionId },
      orderBy: { position: "asc" },
      select: { description: true, position: true, serviceGroupKey: true },
    });
    expect(after.map((l) => l.description)).toEqual(["Brake pads", "Brake rotor", "Tune-up line"]);
    expect(after.map((l) => l.position)).toEqual([1, 2, 3]);
    expect(after.every((l) => l.serviceGroupKey === "front-brakes")).toBe(true);
  });

  it("rejects an order payload that is not exactly the revision's lines", async () => {
    const { createDraftRevision, addLine, reorderLines } =
      await import("@/modules/estimates/estimate-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      kind: "PART",
      serviceGroupKey: "general",
      description: "Only line",
      quantityMilli: 1000,
      unitPriceMinor: 1000,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 1,
    });

    await expect(
      reorderLines({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        items: [],
      }),
    ).rejects.toMatchObject({ reason: "items_mismatch" });
  });

  it("renames a job group: key and label move together, conflicts refused", async () => {
    const { createDraftRevision, addLine, renameServiceGroup } =
      await import("@/modules/estimates/estimate-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    for (const [group, label, position] of [
      ["front-brakes", "Front brakes", 1],
      ["tune-up", "Tune up", 2],
    ] as const) {
      await addLine({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        kind: "PART",
        serviceGroupKey: group,
        description: `${label} line`,
        quantityMilli: 1000,
        unitPriceMinor: 1000,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position,
        serviceGroupLabel: label,
      });
    }

    const renamed = await renameServiceGroup({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      key: "front-brakes",
      label: "Front Brake Service!",
    });
    expect(renamed.key).toBe("front-brake-service");

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: rev.revisionId, serviceGroupKey: "front-brake-service" },
      select: { serviceGroupLabel: true },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.serviceGroupLabel).toBe("Front Brake Service!");

    // Renaming onto an existing group's slug is a conflict, not a merge.
    await expect(
      renameServiceGroup({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        key: "front-brake-service",
        label: "Tune Up",
      }),
    ).rejects.toMatchObject({ reason: "group_name_conflict" });
  });

  it("stores service group labels and exposes them for grouped rendering", async () => {
    const { createDraftRevision, addLine, presentRevision } =
      await import("@/modules/estimates/estimate-service");
    const { getAuthorizationState } = await import("@/modules/estimates/authorization-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    for (const [position, description] of [
      [1, "Front rotors"],
      [2, "Front pads"],
      [3, "Brake labor"],
    ] as const) {
      await addLine({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        kind: position === 3 ? "LABOR" : "PART",
        serviceGroupKey: "front-brakes",
        description,
        quantityMilli: 1000,
        unitPriceMinor: 1000,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position,
        serviceGroupLabel: "Front brakes",
      });
    }
    await presentRevision({ db: dbModule.db, context, revisionId: rev.revisionId });

    const state = await getAuthorizationState({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
    });
    expect(state.lines.length).toBe(3);
    for (const line of state.lines) {
      expect(line.serviceGroupKey).toBe("front-brakes");
      expect(line.serviceGroupLabel).toBe("Front brakes");
    }
  });

  it("invoices only the chosen option, never the declined sibling", async () => {
    const { createDraftRevision, addLine, presentRevision } =
      await import("@/modules/estimates/estimate-service");
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    for (const [position, description, price] of [
      [1, "Basic service", 5000],
      [2, "Deluxe service", 9000],
    ] as const) {
      await addLine({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        kind: "LABOR",
        serviceGroupKey: "service",
        description,
        quantityMilli: 1000,
        unitPriceMinor: price,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position,
        optionGroupKey: "service-level",
        optionGroupLabel: "Service level",
      });
    }
    await presentRevision({ db: dbModule.db, context, revisionId: rev.revisionId });

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: rev.revisionId },
      select: { id: true, description: true },
    });
    const deluxe = lines.find((l) => l.description === "Deluxe service")!;

    await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      method: "EMAIL",
      providedByName: "Opt Customer",
      decisions: [{ estimateLineId: deluxe.id, decision: "APPROVED" }],
    });

    const invoice = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });

    const invoiceLines = await dbModule.db.invoiceLine.findMany({
      where: { invoiceId: invoice.invoiceId },
      select: { description: true },
    });
    const descriptions = invoiceLines.map((l) => l.description);
    expect(descriptions).toContain("Deluxe service");
    expect(descriptions).not.toContain("Basic service");
  });
});
