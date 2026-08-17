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
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Tracker Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `org-${otherOrgId.slice(0, 8)}`, name: "Other Tracker Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `tr-${userId.slice(0, 8)}@example.test`,
        displayName: "Tracker User",
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
        displayName: "Tracker Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-9901",
        customerConcern: "Track me",
        status: "IN_PROGRESS",
      },
    }),
  ]);

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  return {
    orgId,
    otherOrgId,
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

async function addActivity(
  workOrderId: string,
  eventType: string,
  summary: string,
  data: Record<string, unknown> = {},
) {
  await dbModule.db.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: (await dbModule.db.workOrder.findUnique({ where: { id: workOrderId } }))!
        .organizationId,
      locationId: (await dbModule.db.workOrder.findUnique({ where: { id: workOrderId } }))!
        .locationId,
      workOrderId,
      eventType,
      summary,
      data: JSON.parse(JSON.stringify(data)),
    },
  });
}

describe("customer repair tracker (#138)", { skip: shouldSkip }, () => {
  it("issues, rotates, and revokes the tracker link", async () => {
    const {
      getOrCreateTrackerLink,
      regenerateTrackerLink,
      revokeTrackerLink,
      buildRepairTrackerView,
    } = await import("@/modules/work-orders/tracker-link-service");
    const seedData = await seed();

    const first = await getOrCreateTrackerLink({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    // get-or-create is idempotent.
    const again = await getOrCreateTrackerLink({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    expect(again.token).toBe(first.token);

    const rotated = await regenerateTrackerLink({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    expect(rotated.token).not.toBe(first.token);
    await expect(buildRepairTrackerView(dbModule.db, first.token)).rejects.toMatchObject({
      reason: "invalid_token",
    });

    await revokeTrackerLink({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    await expect(buildRepairTrackerView(dbModule.db, rotated.token)).rejects.toMatchObject({
      reason: "link_revoked",
    });
  });

  it("serves a curated customer view — internal events never leak", async () => {
    const { getOrCreateTrackerLink, buildRepairTrackerView } =
      await import("@/modules/work-orders/tracker-link-service");
    const seedData = await seed();

    await addActivity(seedData.workOrderId, "work_order.status_changed", "internal", {
      to: "IN_PROGRESS",
    });
    await addActivity(seedData.workOrderId, "estimate.presented", "Estimate revision 1 presented.");
    await addActivity(seedData.workOrderId, "time.started", "Timer started.");
    await addActivity(
      seedData.workOrderId,
      "estimate.email_unavailable",
      "Email connector not configured; secret detail.",
    );
    await addActivity(seedData.workOrderId, "parts.ordered", "Parts ordered from Worldpac.");
    await addActivity(
      seedData.workOrderId,
      "payment.recorded",
      "Payment of 10600 minor units recorded via CASH.",
    );

    const { token } = await getOrCreateTrackerLink({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    const view = await buildRepairTrackerView(dbModule.db, token);

    expect(view.workOrderNumber).toBe("RO-9901");
    expect(view.organizationName).toBe("Tracker Org");
    expect(view.statusLabel).toBe("Your vehicle is being serviced");
    expect(view.awaitingParts).toBe(false);

    const labels = view.timeline.map((entry) => entry.label);
    expect(labels).toContain("Estimate sent for your approval");
    expect(labels).toContain("Parts ordered");
    expect(labels).toContain("Payment received");
    // Curated status label from structured data, not the raw summary.
    expect(labels).toContain("Your vehicle is being serviced");
    // Internal-only events are excluded entirely.
    expect(labels.join(" ")).not.toContain("Timer");
    expect(labels.join(" ")).not.toContain("connector");
  });

  it("surfaces a pending approval action with the authorize URL", async () => {
    const { getOrCreateTrackerLink, buildRepairTrackerView } =
      await import("@/modules/work-orders/tracker-link-service");
    const seedData = await seed();
    const workOrder = await dbModule.db.workOrder.findUnique({
      where: { id: seedData.workOrderId },
    });

    const revision = await dbModule.db.estimateRevision.create({
      data: {
        organizationId: seedData.orgId,
        locationId: workOrder!.locationId,
        workOrderId: seedData.workOrderId,
        revisionNumber: 1,
        status: "PRESENTED",
        documentKind: "CHANGE_ORDER",
        changeOrderNumber: 1,
        currency: "USD",
        subtotalMinor: 100n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 100n,
        presentedAt: new Date(),
      },
    });
    await dbModule.db.authorizationLink.create({
      data: {
        id: randomUUID(),
        organizationId: seedData.orgId,
        estimateRevisionId: revision.id,
        token: "pending-decision-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const { token } = await getOrCreateTrackerLink({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    const view = await buildRepairTrackerView(dbModule.db, token);
    expect(view.awaitingApproval).toBe(true);
    expect(view.authorizeUrl).toBe("/authorize/pending-decision-token");

    // A used decision link is no longer an outstanding action.
    await dbModule.db.authorizationLink.updateMany({
      where: { token: "pending-decision-token" },
      data: { usedAt: new Date() },
    });
    const updated = await buildRepairTrackerView(dbModule.db, token);
    expect(updated.awaitingApproval).toBe(false);
    expect(updated.authorizeUrl).toBeNull();
  });

  it("shows the invoice balance and keeps links tenant-scoped", async () => {
    const { getOrCreateTrackerLink, buildRepairTrackerView, regenerateTrackerLink } =
      await import("@/modules/work-orders/tracker-link-service");
    const seedA = await seed();
    const seedB = await seed();

    const invoice = await dbModule.db.invoice.create({
      data: {
        organizationId: seedA.orgId,
        locationId: (await dbModule.db.workOrder.findUnique({ where: { id: seedA.workOrderId } }))!
          .locationId,
        workOrderId: seedA.workOrderId,
        number: "INV-2001",
        status: "PARTIALLY_PAID",
        issuedAt: new Date(),
        currency: "USD",
        subtotalMinor: 10000n,
        discountMinor: 0n,
        taxMinor: 600n,
        totalMinor: 10600n,
        paidMinor: 5000n,
      },
    });
    void invoice;

    const { token } = await getOrCreateTrackerLink({
      db: dbModule.db,
      context: seedA.context(),
      workOrderId: seedA.workOrderId,
    });
    const view = await buildRepairTrackerView(dbModule.db, token);
    expect(view.invoice?.number).toBe("INV-2001");
    expect(view.invoice?.paidMinor).toBe("5000");

    // Org B cannot manage org A's link, and a random token is invalid.
    await expect(
      regenerateTrackerLink({
        db: dbModule.db,
        context: seedB.context(),
        workOrderId: seedA.workOrderId,
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
    await expect(buildRepairTrackerView(dbModule.db, "not-a-real-token")).rejects.toMatchObject({
      reason: "invalid_token",
    });
  });
});
