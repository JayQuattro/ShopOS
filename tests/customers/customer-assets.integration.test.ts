import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";

/**
 * Integration tests for customers (#11), assets (#12), and search (#13).
 * Exercises: customer CRUD + archive, contacts, addresses, asset CRUD with
 * profiles, cross-org denial, search scoping, and identifier guessing.
 */

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

async function seedOrg(): Promise<{
  orgId: string;
  locationId: string;
  context: () => import("@/modules/tenancy/policy").TenantContext;
}> {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Test Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `u-${userId.slice(0, 8)}@example.test`, displayName: "Test User" },
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
        permissions: ["customers.read", "customers.write", "assets.read", "assets.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
  ]);

  return {
    orgId,
    locationId,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set([
          "customers.read",
          "customers.write",
          "assets.read",
          "assets.write",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("customer contacts and addresses (#11)", { skip: shouldSkip }, () => {
  it("creates a customer with contacts and addresses", async () => {
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const { addContact, addAddress } = await import("@/modules/customers/customer-service");
    const seed = await seedOrg();
    const context = seed.context();
    const repo = new CustomerRepository({ db: dbModule.db, context });

    const customer = await repo.create({ kind: "BUSINESS", displayName: "Fleet Co" });

    const contact = await addContact({
      db: dbModule.db,
      context,
      customerId: customer.id,
      name: "Fleet Manager",
      role: "Operations",
      email: "fleet@example.test",
      isPrimary: true,
    });
    expect(contact.contactId).toBeTruthy();

    const address = await addAddress({
      db: dbModule.db,
      context,
      customerId: customer.id,
      label: "HQ",
      line1: "123 Main St",
      city: "Raleigh",
      stateProvince: "NC",
      isPrimary: true,
    });
    expect(address.addressId).toBeTruthy();

    // Verify they're in the DB.
    const contacts = await dbModule.db.customerContact.findMany({
      where: { customerId: customer.id },
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.isPrimary).toBe(true);

    const addresses = await dbModule.db.customerAddress.findMany({
      where: { customerId: customer.id },
    });
    expect(addresses).toHaveLength(1);
    expect(addresses[0]?.city).toBe("Raleigh");
  });

  it("enforces only one primary contact per customer", async () => {
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const { addContact } = await import("@/modules/customers/customer-service");
    const seed = await seedOrg();
    const context = seed.context();
    const repo = new CustomerRepository({ db: dbModule.db, context });

    const customer = await repo.create({ kind: "BUSINESS", displayName: "Multi Contact Co" });
    await addContact({
      db: dbModule.db,
      context,
      customerId: customer.id,
      name: "First",
      isPrimary: true,
    });
    await addContact({
      db: dbModule.db,
      context,
      customerId: customer.id,
      name: "Second",
      isPrimary: true,
    });

    const contacts = await dbModule.db.customerContact.findMany({
      where: { customerId: customer.id },
    });
    const primaries = contacts.filter((c) => c.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.name).toBe("Second");
  });

  it("denies adding a contact to a cross-org customer", async () => {
    const { addContact, CustomerMutationFailed } =
      await import("@/modules/customers/customer-service");
    const seedA = await seedOrg();
    const seedB = await seedOrg();
    const customerB = await dbModule.db.customer.create({
      data: {
        id: randomUUID(),
        organizationId: seedB.orgId,
        kind: "INDIVIDUAL",
        displayName: "Org B Customer",
      },
    });

    await expect(
      addContact({
        db: dbModule.db,
        context: seedA.context(),
        customerId: customerB.id,
        name: "Cross Org",
      }),
    ).rejects.toMatchObject({ reason: "customer_not_found" });
    expect(new CustomerMutationFailed("customer_not_found")).toBeInstanceOf(CustomerMutationFailed);
  });
});

describe("asset CRUD with typed profiles (#12)", { skip: shouldSkip }, () => {
  it("creates an asset and sets an automotive profile", async () => {
    const { AssetRepository } = await import("@/modules/assets/asset-repository");
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const seed = await seedOrg();
    const context = seed.context();
    const customerRepo = new CustomerRepository({ db: dbModule.db, context });
    const assetRepo = new AssetRepository({ db: dbModule.db, context });

    const customer = await customerRepo.create({ kind: "INDIVIDUAL", displayName: "Car Owner" });
    const asset = await assetRepo.create({
      customerId: customer.id,
      displayName: "2018 Honda Civic",
      category: "automobile",
      manufacturer: "Honda",
      model: "Civic",
      modelYear: 2018,
    });
    expect(asset.id).toBeTruthy();

    await assetRepo.setAutomotiveProfile(asset.id, {
      vin: "1HGBH41JXMN109187",
      trim: "EX",
      engine: "1.5L I4 Turbo",
      drivetrain: "FWD",
    });

    const detail = await assetRepo.findById(asset.id);
    expect(detail?.automotiveProfile?.vin).toBe("1HGBH41JXMN109187");
    expect(detail?.hasAutomotiveProfile).toBe(true);
  });

  it("creates an asset and sets an equipment profile", async () => {
    const { AssetRepository } = await import("@/modules/assets/asset-repository");
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const seed = await seedOrg();
    const context = seed.context();
    const customerRepo = new CustomerRepository({ db: dbModule.db, context });
    const assetRepo = new AssetRepository({ db: dbModule.db, context });

    const customer = await customerRepo.create({ kind: "BUSINESS", displayName: "Landscaping Co" });
    const asset = await assetRepo.create({
      customerId: customer.id,
      displayName: "Exmark Lazer Z",
      category: "outdoor_power_equipment",
      manufacturer: "Exmark",
    });

    await assetRepo.setEquipmentProfile(asset.id, {
      engineModel: "Kawasaki FX801V",
      fuelType: "gasoline",
      equipmentCategory: "zero_turn_mower",
    });

    const detail = await assetRepo.findById(asset.id);
    expect(detail?.equipmentProfile?.engineModel).toBe("Kawasaki FX801V");
  });

  it("denies creating an asset for a cross-org customer", async () => {
    const { AssetRepository } = await import("@/modules/assets/asset-repository");
    const seedA = await seedOrg();
    const seedB = await seedOrg();
    const customerB = await dbModule.db.customer.create({
      data: {
        id: randomUUID(),
        organizationId: seedB.orgId,
        kind: "INDIVIDUAL",
        displayName: "Org B Customer",
      },
    });

    const assetRepo = new AssetRepository({ db: dbModule.db, context: seedA.context() });
    await expect(
      assetRepo.create({
        customerId: customerB.id,
        displayName: "Cross Org Asset",
        category: "automobile",
      }),
    ).rejects.toThrow();
  });

  it("returns null for a cross-org asset lookup (no existence leak)", async () => {
    const { AssetRepository } = await import("@/modules/assets/asset-repository");
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const seedA = await seedOrg();
    const seedB = await seedOrg();
    const contextB = seedB.context();
    const customerB = await new CustomerRepository({ db: dbModule.db, context: contextB }).create({
      kind: "INDIVIDUAL",
      displayName: "B Customer",
    });
    const assetRepoB = new AssetRepository({ db: dbModule.db, context: contextB });
    const assetB = await assetRepoB.create({
      customerId: customerB.id,
      displayName: "B Asset",
      category: "automobile",
    });

    const assetRepoA = new AssetRepository({ db: dbModule.db, context: seedA.context() });
    const crossOrg = await assetRepoA.findById(assetB.id);
    const guessed = await assetRepoA.findById(randomUUID());
    expect(crossOrg).toBeNull();
    expect(guessed).toBeNull();
  });
});

describe("tenant-scoped search (#13)", { skip: shouldSkip }, () => {
  it("finds customers only within the actor's organization", async () => {
    const { searchCustomers } = await import("@/modules/customers/customer-search");
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const seedA = await seedOrg();
    const seedB = await seedOrg();
    const contextA = seedA.context();
    const contextB = seedB.context();

    await new CustomerRepository({ db: dbModule.db, context: contextA }).create({
      kind: "INDIVIDUAL",
      displayName: "Alice Alpha",
    });
    await new CustomerRepository({ db: dbModule.db, context: contextB }).create({
      kind: "INDIVIDUAL",
      displayName: "Alice Beta",
    });

    const resultsA = await searchCustomers({ db: dbModule.db, context: contextA, query: "Alice" });
    expect(resultsA).toHaveLength(1);
    expect(resultsA[0]?.displayName).toBe("Alice Alpha");
  });

  it("finds assets only within the actor's organization", async () => {
    const { searchAssets } = await import("@/modules/customers/customer-search");
    const { AssetRepository } = await import("@/modules/assets/asset-repository");
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const seedA = await seedOrg();
    const seedB = await seedOrg();
    const contextA = seedA.context();
    const contextB = seedB.context();

    const customerA = await new CustomerRepository({ db: dbModule.db, context: contextA }).create({
      kind: "INDIVIDUAL",
      displayName: "A Customer",
    });
    await new AssetRepository({ db: dbModule.db, context: contextA }).create({
      customerId: customerA.id,
      displayName: "Honda Civic",
      category: "automobile",
      manufacturer: "Honda",
    });

    const customerB = await new CustomerRepository({ db: dbModule.db, context: contextB }).create({
      kind: "INDIVIDUAL",
      displayName: "B Customer",
    });
    await new AssetRepository({ db: dbModule.db, context: contextB }).create({
      customerId: customerB.id,
      displayName: "Honda Accord",
      category: "automobile",
      manufacturer: "Honda",
    });

    const resultsA = await searchAssets({ db: dbModule.db, context: contextA, query: "Honda" });
    expect(resultsA).toHaveLength(1);
    expect(resultsA[0]?.displayName).toBe("Honda Civic");
  });

  it("respects the result limit", async () => {
    const { searchCustomers } = await import("@/modules/customers/customer-search");
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const seed = await seedOrg();
    const context = seed.context();
    const repo = new CustomerRepository({ db: dbModule.db, context });

    for (let i = 0; i < 5; i++) {
      await repo.create({ kind: "INDIVIDUAL", displayName: `Test Customer ${i}` });
    }

    const results = await searchCustomers({ db: dbModule.db, context, query: "Test", limit: 2 });
    expect(results).toHaveLength(2);
  });
});
