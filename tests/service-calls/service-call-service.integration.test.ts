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
  const techId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const otherOrgCustomerId = randomUUID();
  const fleetAssetId = randomUUID();
  const otherOrgAssetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Roadside Org",
        addressLine1: "100 Shop Way",
        city: "Redmond",
        stateProvince: "WA",
        postalCode: "98052",
      },
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
        email: `r-${userId.slice(0, 8)}@example.test`,
        displayName: "Dispatcher",
      },
    }),
    dbModule.db.user.create({
      data: { id: techId, email: `t-${techId.slice(0, 8)}@example.test`, displayName: "Road Tech" },
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
        id: randomUUID(),
        organizationId: orgId,
        userId: techId,
        organizationWideLocationAccess: true,
      },
    }),
    dbModule.db.role.create({
      data: {
        id: roleId,
        organizationId: orgId,
        key: "owner",
        name: "Owner",
        permissions: ["work_orders.read", "work_orders.write", "customers.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Stranded Driver",
      },
    }),
    dbModule.db.customer.create({
      data: {
        id: otherOrgCustomerId,
        organizationId: otherOrgId,
        kind: "INDIVIDUAL",
        displayName: "Other Org Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: fleetAssetId,
        organizationId: orgId,
        customerId,
        displayName: "Service Truck 1",
        category: "truck",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: otherOrgAssetId,
        organizationId: otherOrgId,
        customerId: otherOrgCustomerId,
        displayName: "Other Org Truck",
        category: "truck",
      },
    }),
  ]);

  return {
    orgId,
    otherOrgId,
    locationId,
    customerId,
    otherOrgCustomerId,
    fleetAssetId,
    otherOrgAssetId,
    techId,
    context: (permissions?: readonly string[]) =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set<string>(permissions ?? ["work_orders.read", "work_orders.write"]),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

const CALL_INPUT = {
  locationId: "", // filled per test
  customerId: "", // filled per test
  kind: "JUMPSTART" as const,
  contactPhone: "+15550101234",
  addressLine1: "15001 NE 36th St",
  city: "Redmond",
  stateProvince: "WA",
  postalCode: "98052",
  note: "Dead battery in the parking garage",
};

describe("service calls (#175)", { skip: shouldSkip }, () => {
  it("runs the full dispatch lifecycle with console-geocoded location and ETA", async () => {
    const service = await import("@/modules/service-calls/service-call-service");
    const seed = await seedShop();
    const context = seed.context();

    const { serviceCallId } = await service.createServiceCall({
      db: dbModule.db,
      context,
      ...CALL_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });

    // Test env resolves the console adapter: deterministic geocode snapshot.
    let call = await service.getServiceCall({ db: dbModule.db, context, serviceCallId });
    expect(call?.status).toBe("REQUESTED");
    expect(call?.lat).toBeCloseTo(47.639_62, 5);
    expect(call?.lng).toBeCloseTo(-122.128_331, 5);
    expect(call?.geocodedFormatted).toContain("15001 NE 36th St");
    expect(call?.customerName).toBe("Stranded Driver");

    // Dispatch snapshots the console route: 1020 s / 12500 m.
    await service.dispatchServiceCall({
      db: dbModule.db,
      context,
      serviceCallId,
      technicianUserId: seed.techId,
      fleetAssetId: seed.fleetAssetId,
    });
    call = await service.getServiceCall({ db: dbModule.db, context, serviceCallId });
    expect(call?.status).toBe("DISPATCHED");
    expect(call?.technicianName).toBe("Road Tech");
    expect(call?.fleetAssetName).toBe("Service Truck 1");
    expect(call?.etaSeconds).toBe(1020);
    expect(call?.distanceMeters).toBe(12_500);
    expect(call?.dispatchedAt).not.toBeNull();

    await service.advanceServiceCallStatus({
      db: dbModule.db,
      context,
      serviceCallId,
      target: "EN_ROUTE",
    });
    await service.advanceServiceCallStatus({
      db: dbModule.db,
      context,
      serviceCallId,
      target: "ON_SCENE",
    });

    // On scene the call can only complete.
    await expect(
      service.cancelServiceCall({
        db: dbModule.db,
        context,
        serviceCallId,
        reason: "no longer needed",
      }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });

    await service.advanceServiceCallStatus({
      db: dbModule.db,
      context,
      serviceCallId,
      target: "COMPLETED",
    });
    call = await service.getServiceCall({ db: dbModule.db, context, serviceCallId });
    expect(call?.status).toBe("COMPLETED");
    expect(call?.completedAt).not.toBeNull();

    // Terminal states refuse every further transition.
    await expect(
      service.advanceServiceCallStatus({
        db: dbModule.db,
        context,
        serviceCallId,
        target: "EN_ROUTE",
      }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });
    await expect(
      service.dispatchServiceCall({
        db: dbModule.db,
        context,
        serviceCallId,
        technicianUserId: seed.techId,
      }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });
  });

  it("cancels a requested call with a reason and closes the window on scene", async () => {
    const service = await import("@/modules/service-calls/service-call-service");
    const seed = await seedShop();
    const context = seed.context();

    const { serviceCallId } = await service.createServiceCall({
      db: dbModule.db,
      context,
      ...CALL_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });

    await service.cancelServiceCall({
      db: dbModule.db,
      context,
      serviceCallId,
      reason: "Customer found jumper cables",
    });

    const call = await service.getServiceCall({ db: dbModule.db, context, serviceCallId });
    expect(call?.status).toBe("CANCELLED");
    expect(call?.cancelReason).toBe("Customer found jumper cables");

    // Cancelled calls cannot be dispatched.
    await expect(
      service.dispatchServiceCall({
        db: dbModule.db,
        context,
        serviceCallId,
        technicianUserId: seed.techId,
      }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });

    await expect(
      service.cancelServiceCall({ db: dbModule.db, context, serviceCallId, reason: "again" }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });
  });

  it("converts a call to a work order that inherits the customer and carries the story", async () => {
    const service = await import("@/modules/service-calls/service-call-service");
    const seed = await seedShop();
    const context = seed.context();

    const { serviceCallId } = await service.createServiceCall({
      db: dbModule.db,
      context,
      ...CALL_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });
    await service.dispatchServiceCall({
      db: dbModule.db,
      context,
      serviceCallId,
      technicianUserId: seed.techId,
    });
    await service.advanceServiceCallStatus({
      db: dbModule.db,
      context,
      serviceCallId,
      target: "EN_ROUTE",
    });

    const { workOrderId } = await service.convertServiceCallToWorkOrder({
      db: dbModule.db,
      context,
      serviceCallId,
    });

    const workOrder = await dbModule.db.workOrder.findFirst({
      where: { id: workOrderId, organizationId: seed.orgId },
      select: { customerId: true, locationId: true, customerConcern: true },
    });
    expect(workOrder?.customerId).toBe(seed.customerId);
    expect(workOrder?.locationId).toBe(seed.locationId);
    expect(workOrder?.customerConcern).toContain("Jumpstart");
    expect(workOrder?.customerConcern).toContain("Dead battery");

    const call = await service.getServiceCall({ db: dbModule.db, context, serviceCallId });
    expect(call?.workOrderId).toBe(workOrderId);

    // Completion after conversion lands on the linked work order's activity.
    // (Dispatch/en-route happened before the link, so their history lives on
    // the call record itself, not the work order.)
    await service.advanceServiceCallStatus({
      db: dbModule.db,
      context,
      serviceCallId,
      target: "ON_SCENE",
    });
    await service.advanceServiceCallStatus({
      db: dbModule.db,
      context,
      serviceCallId,
      target: "COMPLETED",
    });
    const events = await dbModule.db.activityEvent.findMany({
      where: { workOrderId, eventType: { startsWith: "service_call." } },
      select: { eventType: true },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => event.eventType)).toContain("service_call.converted");
    expect(events.map((event) => event.eventType)).toContain("service_call.on_scene");
    expect(events.map((event) => event.eventType)).toContain("service_call.completed");

    // Double conversion is refused.
    await expect(
      service.convertServiceCallToWorkOrder({ db: dbModule.db, context, serviceCallId }),
    ).rejects.toMatchObject({ reason: "already_converted" });
  });

  it("denies foreign customers, technicians, and assets by organization", async () => {
    const service = await import("@/modules/service-calls/service-call-service");
    const seed = await seedShop();
    const context = seed.context();

    await expect(
      service.createServiceCall({
        db: dbModule.db,
        context,
        ...CALL_INPUT,
        locationId: seed.locationId,
        customerId: seed.otherOrgCustomerId,
      }),
    ).rejects.toMatchObject({ reason: "customer_not_found" });

    const { serviceCallId } = await service.createServiceCall({
      db: dbModule.db,
      context,
      ...CALL_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });

    // Technician must be an active member of the org doing the dispatching.
    await expect(
      service.dispatchServiceCall({
        db: dbModule.db,
        context,
        serviceCallId,
        technicianUserId: randomUUID(),
      }),
    ).rejects.toMatchObject({ reason: "technician_not_a_member" });

    // Fleet asset from another organization.
    await expect(
      service.dispatchServiceCall({
        db: dbModule.db,
        context,
        serviceCallId,
        technicianUserId: seed.techId,
        fleetAssetId: seed.otherOrgAssetId,
      }),
    ).rejects.toMatchObject({ reason: "asset_not_found" });
  });

  it("never leaks or mutates another organization's calls", async () => {
    const service = await import("@/modules/service-calls/service-call-service");
    const seed = await seedShop();
    const context = seed.context();

    const { serviceCallId } = await service.createServiceCall({
      db: dbModule.db,
      context,
      ...CALL_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });

    // A context from another organization sees nothing and changes nothing.
    const otherContext = {
      ...context,
      organizationId: seed.otherOrgId,
      permissions: new Set(["work_orders.read", "work_orders.write"] as const),
    } as import("@/modules/tenancy/policy").TenantContext;

    expect(
      await service.getServiceCall({ db: dbModule.db, context: otherContext, serviceCallId }),
    ).toBeNull();
    expect(await service.listServiceCalls({ db: dbModule.db, context: otherContext })).toHaveLength(
      0,
    );
    await expect(
      service.dispatchServiceCall({
        db: dbModule.db,
        context: otherContext,
        serviceCallId,
        technicianUserId: seed.techId,
      }),
    ).rejects.toMatchObject({ reason: "service_call_not_found" });
    await expect(
      service.advanceServiceCallStatus({
        db: dbModule.db,
        context: otherContext,
        serviceCallId,
        target: "EN_ROUTE",
      }),
    ).rejects.toMatchObject({ reason: "service_call_not_found" });

    // The call is untouched.
    const call = await service.getServiceCall({ db: dbModule.db, context, serviceCallId });
    expect(call?.status).toBe("REQUESTED");
  });

  it("requires write permission for mutations and read permission for the board", async () => {
    const service = await import("@/modules/service-calls/service-call-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();

    const reader = seed.context(["work_orders.read"]);
    await expect(
      service.createServiceCall({
        db: dbModule.db,
        context: reader,
        ...CALL_INPUT,
        locationId: seed.locationId,
        customerId: seed.customerId,
      }),
    ).rejects.toThrowError(TenantAccessDenied);

    await expect(
      service.listServiceCalls({ db: dbModule.db, context: reader }),
    ).resolves.toBeDefined();

    const noAccess = seed.context([]);
    await expect(
      service.listServiceCalls({ db: dbModule.db, context: noAccess }),
    ).rejects.toThrowError(TenantAccessDenied);
  });

  it("filters the board list by status and technician", async () => {
    const service = await import("@/modules/service-calls/service-call-service");
    const seed = await seedShop();
    const context = seed.context();

    const first = await service.createServiceCall({
      db: dbModule.db,
      context,
      ...CALL_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });
    const second = await service.createServiceCall({
      db: dbModule.db,
      context,
      ...CALL_INPUT,
      kind: "TIRE_CHANGE",
      locationId: seed.locationId,
      customerId: seed.customerId,
    });
    await service.dispatchServiceCall({
      db: dbModule.db,
      context,
      serviceCallId: second.serviceCallId,
      technicianUserId: seed.techId,
    });
    const third = await service.createServiceCall({
      db: dbModule.db,
      context,
      ...CALL_INPUT,
      kind: "LOCKOUT",
      locationId: seed.locationId,
      customerId: seed.customerId,
    });
    await service.cancelServiceCall({
      db: dbModule.db,
      context,
      serviceCallId: third.serviceCallId,
      reason: "Customer unlocked it",
    });

    const open = await service.listServiceCalls({ db: dbModule.db, context, openOnly: true });
    expect(open).toHaveLength(2);

    const dispatched = await service.listServiceCalls({
      db: dbModule.db,
      context,
      status: "DISPATCHED",
    });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.id).toBe(second.serviceCallId);

    const byTech = await service.listServiceCalls({
      db: dbModule.db,
      context,
      technicianUserId: seed.techId,
    });
    expect(byTech).toHaveLength(1);

    const all = await service.listServiceCalls({ db: dbModule.db, context });
    expect(all).toHaveLength(3);
    expect(all.find((call) => call.id === first.serviceCallId)?.status).toBe("REQUESTED");
  });
});
