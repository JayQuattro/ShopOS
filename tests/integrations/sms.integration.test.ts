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
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Sms Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `s-${userId.slice(0, 8)}@example.test`, displayName: "Sms User" },
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
        permissions: ["customers.read", "customers.write", "work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Sms Customer",
        primaryPhone: "+15550100",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-1501",
        customerConcern: "Text me",
        status: "IN_PROGRESS",
      },
    }),
  ]);

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  return {
    orgId,
    customerId,
    workOrderId,
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
          "work_orders.read",
          "work_orders.write",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("two-way texting (#153)", { skip: shouldSkip }, () => {
  it("sends an outbound text, records it, and lists the thread", async () => {
    const { sendCustomerSms, listConversations, listMessages } =
      await import("@/modules/integrations/sms/sms-service");
    const { getConsoleSmsAdapter } = await import("@/modules/integrations/sms/sms-adapters");
    getConsoleSmsAdapter().sent.length = 0;
    const seedData = await seed();

    await sendCustomerSms({
      db: dbModule.db,
      context: seedData.context(),
      customerId: seedData.customerId,
      to: "+1 (555) 010-0", // normalization target: +15550100
      body: "Your car is ready for pickup!",
      workOrderId: seedData.workOrderId,
    });

    expect(getConsoleSmsAdapter().sent).toHaveLength(1);
    expect(getConsoleSmsAdapter().sent[0]?.to).toBe("+15550100");

    const conversations = await listConversations({ db: dbModule.db, context: seedData.context() });
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.customerName).toBe("Sms Customer");
    expect(conversations[0]?.messageCount).toBe(1);

    const messages = await listMessages({
      db: dbModule.db,
      context: seedData.context(),
      conversationId: conversations[0]!.id,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.direction).toBe("outbound");
    expect(messages[0]?.body).toContain("ready for pickup");
    expect(messages[0]?.workOrderId).toBe(seedData.workOrderId);
  });

  it("records inbound replies and matches them to the customer thread", async () => {
    const { sendCustomerSms, listMessages } =
      await import("@/modules/integrations/sms/sms-service");
    const seedData = await seed();

    await sendCustomerSms({
      db: dbModule.db,
      context: seedData.context(),
      customerId: seedData.customerId,
      to: "+15550100",
      body: "First outbound",
    });
    const { recordInboundSms: record } = await import("@/modules/integrations/sms/sms-service");
    const inbound = await record(dbModule.db, {
      organizationId: seedData.orgId,
      from: "+15550100",
      body: "Thanks, picking it up at 5",
    });

    const conversations = await dbModule.db.smsConversation.findMany({
      where: { organizationId: seedData.orgId },
    });
    expect(conversations).toHaveLength(1);
    expect(inbound.conversationId).toBe(conversations[0]!.id);

    const messages = await listMessages({
      db: dbModule.db,
      context: seedData.context(),
      conversationId: conversations[0]!.id,
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.direction).toBe("inbound");
    expect(messages[1]?.body).toContain("picking it up");
  });

  it("creates a customer for unmatched inbound numbers", async () => {
    const { recordInboundSms } = await import("@/modules/integrations/sms/sms-service");
    const seedData = await seed();

    const { conversationId } = await recordInboundSms(dbModule.db, {
      organizationId: seedData.orgId,
      from: "+15559999",
      body: "Do you do alignments?",
    });

    const conversation = await dbModule.db.smsConversation.findUnique({
      where: { id: conversationId },
      include: { customer: true },
    });
    expect(conversation?.customer.primaryPhone).toBe("+15559999");
    expect(conversation?.customer.displayName).toBe("Text 9999");
  });

  it("rejects invalid phones, bodies, and cross-org customers", async () => {
    const { sendCustomerSms } = await import("@/modules/integrations/sms/sms-service");
    const seedA = await seed();
    const seedB = await seed();

    await expect(
      sendCustomerSms({
        db: dbModule.db,
        context: seedA.context(),
        customerId: seedA.customerId,
        to: "555-0100", // no country code
        body: "hi",
      }),
    ).rejects.toMatchObject({ reason: "invalid_phone" });

    await expect(
      sendCustomerSms({
        db: dbModule.db,
        context: seedA.context(),
        customerId: seedA.customerId,
        to: "+15550100",
        body: "",
      }),
    ).rejects.toMatchObject({ reason: "invalid_body" });

    await expect(
      sendCustomerSms({
        db: dbModule.db,
        context: seedA.context(),
        customerId: seedB.customerId,
        to: "+15550100",
        body: "cross-org",
      }),
    ).rejects.toMatchObject({ reason: "customer_not_found" });
  });
});
