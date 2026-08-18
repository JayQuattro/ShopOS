import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { hashPassword } from "better-auth/crypto";

import { db } from "../src/db/client";

const ids = {
  organization: "00000000-0000-4000-8000-000000000001",
  raleigh: "00000000-0000-4000-8000-000000000011",
  durham: "00000000-0000-4000-8000-000000000012",
  owner: "00000000-0000-4000-8000-000000000021",
  membership: "00000000-0000-4000-8000-000000000031",
  ownerRole: "00000000-0000-4000-8000-000000000041",
  alex: "00000000-0000-4000-8000-000000000101",
  oakline: "00000000-0000-4000-8000-000000000102",
  morgan: "00000000-0000-4000-8000-000000000103",
  subaru: "00000000-0000-4000-8000-000000000201",
  motorcycle: "00000000-0000-4000-8000-000000000202",
  mower: "00000000-0000-4000-8000-000000000203",
  projectAsset: "00000000-0000-4000-8000-000000000204",
  subaruWorkOrder: "00000000-0000-4000-8000-000000000301",
  motorcycleWorkOrder: "00000000-0000-4000-8000-000000000302",
  mowerWorkOrder: "00000000-0000-4000-8000-000000000303",
  estimateRevision: "00000000-0000-4000-8000-000000000401",
  estimateLabor: "00000000-0000-4000-8000-000000000411",
  estimatePart: "00000000-0000-4000-8000-000000000412",
  estimateActivity: "00000000-0000-4000-8000-000000000421",
  authorization: "00000000-0000-4000-8000-000000000501",
  motorcycleInvoice: "00000000-0000-4000-8000-000000000601",
  motorcyclePayment: "00000000-0000-4000-8000-000000000701",
  oaklineContact: "00000000-0000-4000-8000-000000000801",
  oaklineAddress: "00000000-0000-4000-8000-000000000802",
  // Operational demo (assignments, appointments, time, tasks, parts,
  // tracker, templates, change orders).
  technician: "00000000-0000-4000-8000-000000000022",
  technicianMembership: "00000000-0000-4000-8000-000000000033",
  priya: "00000000-0000-4000-8000-000000000104",
  civic: "00000000-0000-4000-8000-000000000205",
  demoWorkOrder: "00000000-0000-4000-8000-000000000304",
  demoBaselineRevision: "00000000-0000-4000-8000-000000000402",
  demoBaselineLabor: "00000000-0000-4000-8000-000000000413",
  demoBaselinePart: "00000000-0000-4000-8000-000000000414",
  demoAuthorization: "00000000-0000-4000-8000-000000000502",
  demoAuthorizationDecision: "00000000-0000-4000-8000-000000000503",
  demoChangeOrder: "00000000-0000-4000-8000-000000000403",
  demoChangeOrderPart: "00000000-0000-4000-8000-000000000415",
  demoChangeOrderLabor: "00000000-0000-4000-8000-000000000416",
  demoChangeOrderLink: "00000000-0000-4000-8000-000000000504",
  demoTaskFlagged: "00000000-0000-4000-8000-000000000901",
  demoTaskPassed: "00000000-0000-4000-8000-000000000902",
  demoTaskOpen: "00000000-0000-4000-8000-000000000903",
  demoTimeEntry: "00000000-0000-4000-8000-000000000911",
  demoSupplier: "00000000-0000-4000-8000-000000000921",
  demoPartOrder: "00000000-0000-4000-8000-000000000922",
  demoPartLinePads: "00000000-0000-4000-8000-000000000931",
  demoPartLineRotors: "00000000-0000-4000-8000-000000000932",
  demoAppointmentMorning: "00000000-0000-4000-8000-000000000941",
  demoAppointmentMidday: "00000000-0000-4000-8000-000000000942",
  demoAppointmentAfternoon: "00000000-0000-4000-8000-000000000943",
  demoTrackerLink: "00000000-0000-4000-8000-000000000951",
  demoOilTemplate: "00000000-0000-4000-8000-000000000961",
  demoBrakeTemplate: "00000000-0000-4000-8000-000000000962",
  demoOilLineOil: "00000000-0000-4000-8000-000000000963",
  demoOilLineFilter: "00000000-0000-4000-8000-000000000964",
  demoOilLineLabor: "00000000-0000-4000-8000-000000000965",
  demoOilTaskTires: "00000000-0000-4000-8000-000000000966",
  demoOilTaskFluids: "00000000-0000-4000-8000-000000000967",
  demoBrakeTask1: "00000000-0000-4000-8000-000000000968",
  demoBrakeTask2: "00000000-0000-4000-8000-000000000969",
  demoPhotoAttachment: "00000000-0000-4000-8000-000000000971",
  demoStorageConnector: "00000000-0000-4000-8000-000000000981",
  demoOwnerCredential: "00000000-0000-4000-8000-000000000982",
  demoRoadsideRequested: "00000000-0000-4000-8000-000000000991",
  demoRoadsideDispatched: "00000000-0000-4000-8000-000000000992",
  demoRoadsideCompleted: "00000000-0000-4000-8000-000000000993",
} as const;

async function seed(): Promise<void> {
  await db.$transaction(async (transaction) => {
    await transaction.organization.upsert({
      where: { id: ids.organization },
      update: {},
      create: {
        id: ids.organization,
        slug: "atlas-service",
        name: "Atlas Service Collective",
        defaultCurrency: "USD",
      },
    });

    await transaction.location.createMany({
      data: [
        {
          id: ids.raleigh,
          organizationId: ids.organization,
          code: "RAL",
          name: "Raleigh Shop",
          timeZone: "America/New_York",
        },
        {
          id: ids.durham,
          organizationId: ids.organization,
          code: "DUR",
          name: "Durham Shop",
          timeZone: "America/New_York",
        },
      ],
      skipDuplicates: true,
    });

    await transaction.user.upsert({
      where: { id: ids.owner },
      update: {},
      create: {
        id: ids.owner,
        email: "owner@example.test",
        emailVerified: true,
        displayName: "Jordan Lee",
      },
    });

    await transaction.organizationMembership.upsert({
      where: { id: ids.membership },
      update: {},
      create: {
        id: ids.membership,
        organizationId: ids.organization,
        userId: ids.owner,
        organizationWideLocationAccess: true,
      },
    });

    await transaction.role.upsert({
      where: { id: ids.ownerRole },
      update: {},
      create: {
        id: ids.ownerRole,
        organizationId: ids.organization,
        key: "owner",
        name: "Owner",
        permissions: [
          "organizations.manage",
          "memberships.manage",
          "customers.read",
          "customers.write",
          "assets.read",
          "assets.write",
          "work_orders.read",
          "work_orders.write",
          "estimates.present",
          "authorizations.record",
          "invoices.issue",
          "payments.record",
        ],
      },
    });

    await transaction.membershipRole.upsert({
      where: {
        membershipId_roleId: {
          membershipId: ids.membership,
          roleId: ids.ownerRole,
        },
      },
      update: {},
      create: {
        organizationId: ids.organization,
        membershipId: ids.membership,
        roleId: ids.ownerRole,
      },
    });

    await transaction.customer.createMany({
      data: [
        {
          id: ids.alex,
          organizationId: ids.organization,
          kind: "INDIVIDUAL",
          displayName: "Alex Rivera",
          organizationReference: "C-1001",
          primaryEmail: "alex.rivera@example.test",
          primaryPhone: "555-0101",
        },
        {
          id: ids.oakline,
          organizationId: ids.organization,
          kind: "BUSINESS",
          displayName: "Oakline Grounds Co.",
          organizationReference: "C-1002",
          primaryEmail: "service@oakline.example.test",
          primaryPhone: "555-0102",
        },
        {
          id: ids.morgan,
          organizationId: ids.organization,
          kind: "INDIVIDUAL",
          displayName: "Morgan Chen",
          organizationReference: "C-1003",
          primaryEmail: "morgan.chen@example.test",
          primaryPhone: "555-0103",
        },
      ],
      skipDuplicates: true,
    });

    await transaction.asset.createMany({
      data: [
        {
          id: ids.subaru,
          organizationId: ids.organization,
          customerId: ids.alex,
          homeLocationId: ids.raleigh,
          displayName: "2017 Subaru Outback",
          category: "automobile",
          manufacturer: "Subaru",
          model: "Outback",
          modelYear: 2017,
          usageType: "odometer",
          usageValueMilli: 128_450_000n,
          usageUnit: "mile",
          description: "Daily driver with intermittent braking vibration.",
        },
        {
          id: ids.motorcycle,
          organizationId: ids.organization,
          customerId: ids.morgan,
          homeLocationId: ids.durham,
          displayName: "2022 Honda Africa Twin",
          category: "motorcycle",
          manufacturer: "Honda",
          model: "Africa Twin",
          modelYear: 2022,
          usageType: "odometer",
          usageValueMilli: 18_600_000n,
          usageUnit: "mile",
          description: "Adventure motorcycle due for annual service.",
        },
        {
          id: ids.mower,
          organizationId: ids.organization,
          customerId: ids.oakline,
          homeLocationId: ids.raleigh,
          displayName: "Exmark Lazer Z mower",
          category: "outdoor_power_equipment",
          manufacturer: "Exmark",
          model: "Lazer Z",
          modelYear: 2021,
          usageType: "operating_hours",
          usageValueMilli: 942_500n,
          usageUnit: "hour",
          description: "Commercial zero-turn mower used by a landscape crew.",
        },
        {
          id: ids.projectAsset,
          organizationId: ids.organization,
          customerId: ids.morgan,
          homeLocationId: ids.durham,
          displayName: "1968 Ford F-100 restomod",
          category: "automobile",
          manufacturer: "Ford",
          model: "F-100",
          modelYear: 1968,
          status: "INACTIVE",
          description: "Future custom-build scenario; project workflows are not enabled yet.",
        },
      ],
      skipDuplicates: true,
    });

    await transaction.automotiveAssetProfile.createMany({
      data: [
        {
          assetId: ids.subaru,
          vin: "4S4BSACC0H0000001",
          trim: "Premium",
          engine: "2.5L H4",
          drivetrain: "AWD",
        },
        {
          assetId: ids.motorcycle,
          vin: "JH2SD1000NK000001",
          trim: "Adventure Sports",
          engine: "1084cc parallel-twin",
          drivetrain: "chain",
        },
        {
          assetId: ids.projectAsset,
          trim: "Custom build",
          engine: "Planned Coyote V8",
          drivetrain: "RWD",
        },
      ],
      skipDuplicates: true,
    });

    await transaction.equipmentAssetProfile.upsert({
      where: { assetId: ids.mower },
      update: {},
      create: {
        assetId: ids.mower,
        engineModel: "Kawasaki FX801V",
        fuelType: "gasoline",
        equipmentCategory: "zero_turn_mower",
      },
    });

    await transaction.workOrder.createMany({
      data: [
        {
          id: ids.subaruWorkOrder,
          organizationId: ids.organization,
          locationId: ids.raleigh,
          customerId: ids.alex,
          assetId: ids.subaru,
          number: "RO-1042",
          workType: "REPAIR",
          status: "AWAITING_AUTHORIZATION",
          customerConcern: "Steering wheel shakes during braking from highway speed.",
        },
        {
          id: ids.motorcycleWorkOrder,
          organizationId: ids.organization,
          locationId: ids.durham,
          customerId: ids.morgan,
          assetId: ids.motorcycle,
          number: "RO-1043",
          workType: "MAINTENANCE",
          status: "IN_PROGRESS",
          customerConcern: "Annual service, chain inspection, and brake-fluid replacement.",
        },
        {
          id: ids.mowerWorkOrder,
          organizationId: ids.organization,
          locationId: ids.raleigh,
          customerId: ids.oakline,
          assetId: ids.mower,
          number: "RO-1044",
          workType: "REPAIR",
          status: "ESTIMATING",
          customerConcern: "Engine loses power under load after warming up.",
        },
      ],
      skipDuplicates: true,
    });

    await transaction.estimateRevision.upsert({
      where: { id: ids.estimateRevision },
      update: {},
      create: {
        id: ids.estimateRevision,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        workOrderId: ids.subaruWorkOrder,
        revisionNumber: 1,
        status: "PRESENTED",
        currency: "USD",
        subtotalMinor: 65_000n,
        discountMinor: 5_000n,
        taxMinor: 4_320n,
        totalMinor: 64_320n,
        presentedAt: new Date("2026-07-23T14:00:00Z"),
        createdByUserId: ids.owner,
      },
    });

    await transaction.estimateLine.createMany({
      data: [
        {
          id: ids.estimateLabor,
          organizationId: ids.organization,
          estimateRevisionId: ids.estimateRevision,
          serviceGroupKey: "front-brakes",
          kind: "LABOR",
          description: "Replace front brake pads and rotors",
          quantityMilli: 2_500,
          unitPriceMinor: 16_000n,
          grossMinor: 40_000n,
          discountMinor: 5_000n,
          taxable: true,
          taxRateBasisPoints: 720,
          taxMinor: 2_520n,
          totalMinor: 37_520n,
          position: 1,
        },
        {
          id: ids.estimatePart,
          organizationId: ids.organization,
          estimateRevisionId: ids.estimateRevision,
          serviceGroupKey: "front-brakes",
          kind: "PART",
          description: "Front brake pad and rotor kit",
          quantityMilli: 1_000,
          unitPriceMinor: 25_000n,
          grossMinor: 25_000n,
          discountMinor: 0n,
          taxable: true,
          taxRateBasisPoints: 720,
          taxMinor: 1_800n,
          totalMinor: 26_800n,
          position: 2,
        },
      ],
      skipDuplicates: true,
    });

    await transaction.activityEvent.upsert({
      where: { id: ids.estimateActivity },
      update: {},
      create: {
        id: ids.estimateActivity,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        workOrderId: ids.subaruWorkOrder,
        actorUserId: ids.owner,
        eventType: "estimate.presented",
        summary: "Estimate revision 1 presented for $643.20.",
        occurredAt: new Date("2026-07-23T14:00:00Z"),
      },
    });

    // --- Full workflow: authorization, invoice, payment on the Subaru work order ---

    await transaction.authorization.upsert({
      where: { id: ids.authorization },
      update: {},
      create: {
        id: ids.authorization,
        organizationId: ids.organization,
        estimateRevisionId: ids.estimateRevision,
        method: "IN_PERSON",
        recordedByUserId: ids.owner,
        providedByName: "Alex Rivera",
        note: "Customer approved brake service in person.",
        occurredAt: new Date("2026-07-23T15:00:00Z"),
      },
    });

    await transaction.authorizationDecision.upsert({
      where: {
        authorizationId_estimateLineId: {
          authorizationId: ids.authorization,
          estimateLineId: ids.estimateLabor,
        },
      },
      update: {},
      create: {
        organizationId: ids.organization,
        authorizationId: ids.authorization,
        estimateLineId: ids.estimateLabor,
        decision: "APPROVED",
      },
    });

    await transaction.authorizationDecision.upsert({
      where: {
        authorizationId_estimateLineId: {
          authorizationId: ids.authorization,
          estimateLineId: ids.estimatePart,
        },
      },
      update: {},
      create: {
        organizationId: ids.organization,
        authorizationId: ids.authorization,
        estimateLineId: ids.estimatePart,
        decision: "APPROVED",
      },
    });

    // Update work order status to AUTHORIZED (estimate was presented + approved).
    await transaction.workOrder.update({
      where: { id: ids.subaruWorkOrder },
      data: { status: "AUTHORIZED" },
    });

    // --- Invoice + payment for the motorcycle work order (full flow to CLOSED) ---

    await transaction.invoice.upsert({
      where: { id: ids.motorcycleInvoice },
      update: {},
      create: {
        id: ids.motorcycleInvoice,
        organizationId: ids.organization,
        locationId: ids.durham,
        workOrderId: ids.motorcycleWorkOrder,
        number: "INV-1001",
        status: "PAID",
        currency: "USD",
        subtotalMinor: 32_000n,
        discountMinor: 0n,
        taxMinor: 2_304n,
        totalMinor: 34_304n,
        paidMinor: 34_304n,
        issuedAt: new Date("2026-07-23T10:00:00Z"),
      },
    });

    await transaction.payment.upsert({
      where: { id: ids.motorcyclePayment },
      update: {},
      create: {
        id: ids.motorcyclePayment,
        organizationId: ids.organization,
        locationId: ids.durham,
        invoiceId: ids.motorcycleInvoice,
        amountMinor: 34_304n,
        currency: "USD",
        method: "CARD_EXTERNAL",
        reference: "SEED-DEMO-001",
        receivedAt: new Date("2026-07-23T11:00:00Z"),
        recordedByUserId: ids.owner,
      },
    });

    // Update motorcycle work order to CLOSED (invoice fully paid).
    await transaction.workOrder.update({
      where: { id: ids.motorcycleWorkOrder },
      data: { status: "CLOSED", completedAt: new Date("2026-07-23T10:00:00Z") },
    });

    // --- Customer contact and address for the business customer ---

    await transaction.customerContact.upsert({
      where: { id: ids.oaklineContact },
      update: {},
      create: {
        id: ids.oaklineContact,
        organizationId: ids.organization,
        customerId: ids.oakline,
        name: "Sam Grounds",
        role: "Operations Manager",
        email: "sam@oakline.example.test",
        phone: "555-0199",
        isPrimary: true,
      },
    });

    await transaction.customerAddress.upsert({
      where: { id: ids.oaklineAddress },
      update: {},
      create: {
        id: ids.oaklineAddress,
        organizationId: ids.organization,
        customerId: ids.oakline,
        label: "Main Office",
        line1: "4200 Greenway Blvd",
        city: "Raleigh",
        stateProvince: "NC",
        postalCode: "27607",
        country: "US",
        isPrimary: true,
      },
    });
  });
}

/** Fixed ids for the operational demo section. */
const DEMO_PASSWORD = "demo-password-123";
const DEMO_TRACKER_TOKEN = "demo-tracker-token-please-rotate-in-real-use";
const DEMO_CHANGE_ORDER_TOKEN = "demo-change-order-token-please-rotate";

function todayAtUtc(hour: number): Date {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function seedOperationalDemo(): Promise<void> {
  const existing = await db.workOrder.findUnique({ where: { id: ids.demoWorkOrder } });
  if (existing) {
    // Newer demo slices backfill on already-seeded databases.
    await seedRoadsideDemo();
    console.info("Operational demo data already present — skipping.");
    return;
  }
  await seedRoadsideDemo();

  // A 1×1 transparent PNG standing in for a rotor photo.
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
    "base64",
  );
  const photoObjectKey = `work-orders/${ids.demoWorkOrder}/${ids.demoPhotoAttachment}/scored-rotor.png`;
  const storageBasePath = join(process.cwd(), ".data", "demo-files");
  await mkdir(
    join(
      storageBasePath,
      ids.organization,
      `work-orders/${ids.demoWorkOrder}/${ids.demoPhotoAttachment}`,
    ),
    {
      recursive: true,
    },
  );
  await writeFile(join(storageBasePath, ids.organization, photoObjectKey), pngBytes);

  const baselineApprovedAt = new Date(Date.now() - 26 * 60 * 60 * 1000);
  const changeOrderPresentedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);

  await db.$transaction(async (transaction) => {
    // Local file storage so evidence photos render out of the box.
    await transaction.connectorInstance.upsert({
      where: { id: ids.demoStorageConnector },
      update: {},
      create: {
        id: ids.demoStorageConnector,
        scope: "platform",
        capability: "file_storage",
        adapterKey: "local",
        displayName: "Demo file storage",
        configuration: { basePath: storageBasePath },
        status: "active",
      },
    });

    // Technician (Maria Chen) with the technician role.
    await transaction.user.upsert({
      where: { id: ids.technician },
      update: {},
      create: {
        id: ids.technician,
        email: "maria@example.test",
        emailVerified: true,
        displayName: "Maria Chen",
      },
    });
    await transaction.organizationMembership.upsert({
      where: { id: ids.technicianMembership },
      update: {},
      create: {
        id: ids.technicianMembership,
        organizationId: ids.organization,
        userId: ids.technician,
        organizationWideLocationAccess: true,
      },
    });
    const technicianRole = await transaction.role.findFirst({
      where: { organizationId: ids.organization, key: "technician" },
      select: { id: true },
    });
    if (technicianRole) {
      await transaction.membershipRole.upsert({
        where: {
          organizationId_membershipId_roleId: {
            organizationId: ids.organization,
            membershipId: ids.technicianMembership,
            roleId: technicianRole.id,
          },
        },
        update: {},
        create: {
          organizationId: ids.organization,
          membershipId: ids.technicianMembership,
          roleId: technicianRole.id,
        },
      });
    }

    // Demo customer and vehicle.
    await transaction.customer.create({
      data: {
        id: ids.priya,
        organizationId: ids.organization,
        kind: "INDIVIDUAL",
        displayName: "Priya Patel",
        primaryEmail: "priya@example.test",
      },
    });
    await transaction.asset.create({
      data: {
        id: ids.civic,
        organizationId: ids.organization,
        customerId: ids.priya,
        displayName: "2021 Honda Civic",
        category: "automobile",
      },
    });
    await transaction.customerContact.create({
      data: {
        id: "00000000-0000-4000-8000-000000000811",
        organizationId: ids.organization,
        customerId: ids.priya,
        name: "Priya Patel",
        email: "priya@example.test",
        isPrimary: true,
      },
    });

    // The modern-flow work order: approved baseline, in progress, in Bay 2,
    // with a pending change order awaiting the customer's decision.
    await transaction.workOrder.create({
      data: {
        id: ids.demoWorkOrder,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        customerId: ids.priya,
        assetId: ids.civic,
        number: "RO-2100",
        workType: "REPAIR",
        status: "IN_PROGRESS",
        customerConcern: "Grinding noise when braking; squeal at low speed.",
        assignedTechnicianUserId: ids.technician,
        vehicleStage: "IN_BAY",
        bayLabel: "Bay 2",
        promisedAt: todayAtUtc(21),
      },
    });

    // Approved baseline estimate.
    await transaction.estimateRevision.create({
      data: {
        id: ids.demoBaselineRevision,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        workOrderId: ids.demoWorkOrder,
        revisionNumber: 1,
        status: "PRESENTED",
        documentKind: "BASELINE",
        currency: "USD",
        subtotalMinor: 32000n,
        discountMinor: 0n,
        taxMinor: 2304n,
        totalMinor: 34304n,
        presentedAt: baselineApprovedAt,
        createdByUserId: ids.owner,
      },
    });
    await transaction.estimateLine.createMany({
      data: [
        {
          id: ids.demoBaselineLabor,
          organizationId: ids.organization,
          estimateRevisionId: ids.demoBaselineRevision,
          serviceGroupKey: "brakes",
          kind: "LABOR",
          description: "Front brake service — pads, clean and lube slides",
          quantityMilli: 1200,
          unitPriceMinor: 14500n,
          grossMinor: 17400n,
          discountMinor: 0n,
          taxable: true,
          taxRateBasisPoints: 720,
          taxMinor: 1253n,
          totalMinor: 18653n,
          position: 1,
        },
        {
          id: ids.demoBaselinePart,
          organizationId: ids.organization,
          estimateRevisionId: ids.demoBaselineRevision,
          serviceGroupKey: "brakes",
          kind: "PART",
          description: "Ceramic front pad set",
          quantityMilli: 1000,
          unitPriceMinor: 14600n,
          grossMinor: 14600n,
          discountMinor: 0n,
          taxable: true,
          taxRateBasisPoints: 720,
          taxMinor: 1051n,
          totalMinor: 15651n,
          position: 2,
        },
      ],
    });
    await transaction.authorization.create({
      data: {
        id: ids.demoAuthorization,
        organizationId: ids.organization,
        estimateRevisionId: ids.demoBaselineRevision,
        method: "CUSTOMER_LINK",
        providedByName: "Priya Patel",
        occurredAt: baselineApprovedAt,
      },
    });
    await transaction.authorizationDecision.createMany({
      data: [
        {
          authorizationId: ids.demoAuthorization,
          organizationId: ids.organization,
          estimateLineId: ids.demoBaselineLabor,
          decision: "APPROVED",
        },
        {
          authorizationId: ids.demoAuthorization,
          organizationId: ids.organization,
          estimateLineId: ids.demoBaselinePart,
          decision: "APPROVED",
        },
      ],
    });

    // Inspection checklist: one flagged item that became the change order.
    await transaction.workOrderTask.createMany({
      data: [
        {
          id: ids.demoTaskFlagged,
          organizationId: ids.organization,
          locationId: ids.raleigh,
          workOrderId: ids.demoWorkOrder,
          position: 1,
          title: "Front rotors",
          status: "NEEDS_ATTENTION",
          outcomeNote: "Scored below minimum thickness",
          createdByUserId: ids.owner,
        },
        {
          id: ids.demoTaskPassed,
          organizationId: ids.organization,
          locationId: ids.raleigh,
          workOrderId: ids.demoWorkOrder,
          position: 2,
          title: "Tire tread depth",
          status: "DONE",
          createdByUserId: ids.owner,
        },
        {
          id: ids.demoTaskOpen,
          organizationId: ids.organization,
          locationId: ids.raleigh,
          workOrderId: ids.demoWorkOrder,
          position: 3,
          title: "Brake fluid condition",
          status: "OPEN",
          createdByUserId: ids.owner,
        },
      ],
    });

    // Pending change order from the flagged finding.
    await transaction.estimateRevision.create({
      data: {
        id: ids.demoChangeOrder,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        workOrderId: ids.demoWorkOrder,
        revisionNumber: 2,
        status: "PRESENTED",
        documentKind: "CHANGE_ORDER",
        changeOrderNumber: 1,
        summaryNote: "Found during inspection: front rotors scored below minimum thickness.",
        currency: "USD",
        subtotalMinor: 31140n,
        discountMinor: 0n,
        taxMinor: 2242n,
        totalMinor: 33382n,
        presentedAt: changeOrderPresentedAt,
        createdByUserId: ids.owner,
      },
    });
    await transaction.estimateLine.createMany({
      data: [
        {
          id: ids.demoChangeOrderPart,
          organizationId: ids.organization,
          estimateRevisionId: ids.demoChangeOrder,
          serviceGroupKey: "brakes",
          kind: "PART",
          description: "Front rotor pair — Front rotors — Scored below minimum thickness",
          quantityMilli: 1000,
          unitPriceMinor: 24200n,
          grossMinor: 24200n,
          discountMinor: 0n,
          taxable: true,
          taxRateBasisPoints: 720,
          taxMinor: 1742n,
          totalMinor: 25942n,
          position: 1,
        },
        {
          id: ids.demoChangeOrderLabor,
          organizationId: ids.organization,
          estimateRevisionId: ids.demoChangeOrder,
          serviceGroupKey: "brakes",
          kind: "LABOR",
          description: "Rotor replacement labor",
          quantityMilli: 500,
          unitPriceMinor: 14500n,
          grossMinor: 7250n,
          discountMinor: 0n,
          taxable: true,
          taxRateBasisPoints: 720,
          taxMinor: 522n,
          totalMinor: 7772n,
          position: 2,
        },
      ],
    });
    await transaction.authorizationLink.create({
      data: {
        id: ids.demoChangeOrderLink,
        organizationId: ids.organization,
        estimateRevisionId: ids.demoChangeOrder,
        token: DEMO_CHANGE_ORDER_TOKEN,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    });

    // Evidence photo attached to the change order document.
    await transaction.workOrderAttachment.create({
      data: {
        id: ids.demoPhotoAttachment,
        organizationId: ids.organization,
        workOrderId: ids.demoWorkOrder,
        estimateRevisionId: ids.demoChangeOrder,
        objectKey: photoObjectKey,
        fileName: "scored-rotor.png",
        contentType: "image/png",
        sizeBytes: pngBytes.byteLength,
        uploadedByUserId: ids.owner,
      },
    });

    // Clock time: Maria has an hour and five minutes on the job so far.
    await transaction.timeEntry.create({
      data: {
        id: ids.demoTimeEntry,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        workOrderId: ids.demoWorkOrder,
        userId: ids.technician,
        startedAt: new Date(Date.now() - 95 * 60 * 1000),
        endedAt: new Date(Date.now() - 30 * 60 * 1000),
        note: "Teardown and inspection",
      },
    });

    // Parts: pads arrived, rotors still on the truck.
    await transaction.partSupplier.create({
      data: {
        id: ids.demoSupplier,
        organizationId: ids.organization,
        name: "Worldpac Carolina",
        phone: "555-0140",
      },
    });
    await transaction.partOrder.create({
      data: {
        id: ids.demoPartOrder,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        workOrderId: ids.demoWorkOrder,
        supplierId: ids.demoSupplier,
        status: "ORDERED",
        source: "MANUAL",
        currency: "USD",
        trackingNumber: "TRK-7731",
        orderedAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
        createdByUserId: ids.owner,
      },
    });
    await transaction.partOrderLine.createMany({
      data: [
        {
          id: ids.demoPartLinePads,
          organizationId: ids.organization,
          partOrderId: ids.demoPartOrder,
          description: "Ceramic front pad set",
          partNumber: "PAD-101",
          quantity: 1,
          receivedQuantity: 1,
          unitCostMinor: 8200n,
        },
        {
          id: ids.demoPartLineRotors,
          organizationId: ids.organization,
          partOrderId: ids.demoPartOrder,
          description: "Front rotor pair",
          partNumber: "ROT-220",
          quantity: 1,
          receivedQuantity: 0,
          unitCostMinor: 14100n,
        },
      ],
    });

    // Today's schedule at Raleigh (times UTC; Raleigh is America/New_York).
    await transaction.appointment.createMany({
      data: [
        {
          id: ids.demoAppointmentMorning,
          organizationId: ids.organization,
          locationId: ids.raleigh,
          customerId: ids.alex,
          assetId: ids.subaru,
          status: "SCHEDULED",
          reason: "Oil change and tire rotation",
          startAt: todayAtUtc(13),
          endAt: todayAtUtc(14),
          createdByUserId: ids.owner,
        },
        {
          id: ids.demoAppointmentMidday,
          organizationId: ids.organization,
          locationId: ids.raleigh,
          customerId: ids.oakline,
          status: "CONFIRMED",
          reason: "Fleet van — brake inspection",
          startAt: todayAtUtc(16),
          endAt: todayAtUtc(17),
          createdByUserId: ids.owner,
        },
        {
          id: ids.demoAppointmentAfternoon,
          organizationId: ids.organization,
          locationId: ids.raleigh,
          customerId: ids.priya,
          assetId: ids.civic,
          workOrderId: ids.demoWorkOrder,
          status: "CHECKED_IN",
          reason: "Grinding noise when braking",
          startAt: todayAtUtc(18),
          endAt: todayAtUtc(19),
          createdByUserId: ids.owner,
        },
      ],
    });

    // Service menu templates.
    await transaction.serviceTemplate.create({
      data: {
        id: ids.demoOilTemplate,
        organizationId: ids.organization,
        name: "Oil change — synthetic",
        notes: "Includes top-off and tire check.",
      },
    });
    await transaction.serviceTemplateLine.createMany({
      data: [
        {
          id: ids.demoOilLineOil,
          organizationId: ids.organization,
          serviceTemplateId: ids.demoOilTemplate,
          position: 1,
          kind: "PART",
          serviceGroupKey: "oil",
          description: "Synthetic oil 5W-30 (5 qt)",
          quantityMilli: 5000,
          unitPriceMinor: 8500n,
          taxable: false,
          taxRateBasisPoints: 0,
        },
        {
          id: ids.demoOilLineFilter,
          organizationId: ids.organization,
          serviceTemplateId: ids.demoOilTemplate,
          position: 2,
          kind: "PART",
          serviceGroupKey: "oil",
          description: "Oil filter",
          quantityMilli: 1000,
          unitPriceMinor: 1200n,
          taxable: false,
          taxRateBasisPoints: 0,
        },
        {
          id: ids.demoOilLineLabor,
          organizationId: ids.organization,
          serviceTemplateId: ids.demoOilTemplate,
          position: 3,
          kind: "LABOR",
          serviceGroupKey: "oil",
          description: "Change oil and filter",
          quantityMilli: 500,
          unitPriceMinor: 3500n,
          taxable: false,
          taxRateBasisPoints: 0,
        },
      ],
    });
    await transaction.serviceTemplateTask.createMany({
      data: [
        {
          id: ids.demoOilTaskTires,
          organizationId: ids.organization,
          serviceTemplateId: ids.demoOilTemplate,
          position: 1,
          title: "Check tire pressure",
        },
        {
          id: ids.demoOilTaskFluids,
          organizationId: ids.organization,
          serviceTemplateId: ids.demoOilTemplate,
          position: 2,
          title: "Top off fluids",
        },
      ],
    });
    await transaction.serviceTemplate.create({
      data: {
        id: ids.demoBrakeTemplate,
        organizationId: ids.organization,
        name: "Brake inspection",
      },
    });
    await transaction.serviceTemplateTask.createMany({
      data: [
        {
          id: ids.demoBrakeTask1,
          organizationId: ids.organization,
          serviceTemplateId: ids.demoBrakeTemplate,
          position: 1,
          title: "Front brake pads",
        },
        {
          id: ids.demoBrakeTask2,
          organizationId: ids.organization,
          serviceTemplateId: ids.demoBrakeTemplate,
          position: 2,
          title: "Rotor thickness",
        },
      ],
    });

    // A narrated history so the customer tracker has a timeline.
    await transaction.activityEvent.createMany({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000983",
          organizationId: ids.organization,
          locationId: ids.raleigh,
          workOrderId: ids.demoWorkOrder,
          actorUserId: ids.owner,
          eventType: "estimate.presented",
          summary: "Estimate revision 1 presented.",
          occurredAt: new Date(Date.now() - 27 * 60 * 60 * 1000),
        },
        {
          id: "00000000-0000-4000-8000-000000000984",
          organizationId: ids.organization,
          locationId: ids.raleigh,
          workOrderId: ids.demoWorkOrder,
          actorUserId: ids.owner,
          eventType: "authorization.recorded",
          summary: "Authorization recorded: 2 approved, 0 declined.",
          occurredAt: baselineApprovedAt,
        },
        {
          id: "00000000-0000-4000-8000-000000000985",
          organizationId: ids.organization,
          locationId: ids.raleigh,
          workOrderId: ids.demoWorkOrder,
          actorUserId: ids.owner,
          eventType: "work_order.status_changed",
          summary: "Status changed from AUTHORIZED to IN_PROGRESS.",
          data: { from: "AUTHORIZED", to: "IN_PROGRESS" },
          occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
        {
          id: "00000000-0000-4000-8000-000000000986",
          organizationId: ids.organization,
          locationId: ids.raleigh,
          workOrderId: ids.demoWorkOrder,
          actorUserId: ids.owner,
          eventType: "parts.ordered",
          summary: "Parts ordered from Worldpac Carolina (tracking TRK-7731).",
          occurredAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
        },
        {
          id: "00000000-0000-4000-8000-000000000987",
          organizationId: ids.organization,
          locationId: ids.raleigh,
          workOrderId: ids.demoWorkOrder,
          actorUserId: ids.owner,
          eventType: "change_order.presented",
          summary: "Change order 1 presented for customer authorization.",
          occurredAt: changeOrderPresentedAt,
        },
      ],
    });

    // Customer repair tracker link.
    await transaction.repairTrackerLink.create({
      data: {
        id: ids.demoTrackerLink,
        organizationId: ids.organization,
        workOrderId: ids.demoWorkOrder,
        token: DEMO_TRACKER_TOKEN,
      },
    });
  });

  // A real password for the demo owner (Better Auth credential account).
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await db.authAccount.upsert({
    where: { id: ids.demoOwnerCredential },
    update: { password: passwordHash },
    create: {
      id: ids.demoOwnerCredential,
      userId: ids.owner,
      accountId: ids.owner,
      providerId: "credential",
      password: passwordHash,
    },
  });

  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  console.info("");
  console.info("──────────────────────────────────────────────────────");
  console.info("Operational demo data seeded.");
  console.info(`Sign in:        owner@example.test / ${DEMO_PASSWORD}`);
  console.info(`Technician:     maria@example.test (no password — use magic link)`);
  console.info(`Repair tracker: ${base}/track/${DEMO_TRACKER_TOKEN}`);
  console.info(`Change order:   ${base}/authorize/${DEMO_CHANGE_ORDER_TOKEN}`);
  console.info("──────────────────────────────────────────────────────");
}

/** Roadside demo calls; idempotent so re-seeding older databases backfills. */
async function seedRoadsideDemo(): Promise<void> {
  const existing = await db.serviceCall.findUnique({ where: { id: ids.demoRoadsideRequested } });
  if (existing) return;

  const dispatchedAt = new Date(Date.now() - 25 * 60 * 1000);
  await db.serviceCall.createMany({
    data: [
      {
        id: ids.demoRoadsideRequested,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        customerId: ids.oakline,
        kind: "JUMPSTART",
        status: "REQUESTED",
        contactPhone: "+1-919-555-0141",
        addressLine1: "2606 Hillsborough St",
        city: "Raleigh",
        stateProvince: "NC",
        postalCode: "27608",
        note: "Click, no crank — parking lot of the taco shop.",
      },
      {
        id: ids.demoRoadsideDispatched,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        customerId: ids.priya,
        kind: "TIRE_CHANGE",
        status: "EN_ROUTE",
        contactPhone: "+1-919-555-0177",
        addressLine1: "4509 Durham Western Blvd",
        city: "Durham",
        stateProvince: "NC",
        postalCode: "27707",
        note: "Front left flat, spare in the trunk.",
        assignedTechnicianUserId: ids.technician,
        dispatchedAt,
        enRouteAt: new Date(Date.now() - 12 * 60 * 1000),
        etaSeconds: 1020,
        distanceMeters: 12_500,
      },
      {
        id: ids.demoRoadsideCompleted,
        organizationId: ids.organization,
        locationId: ids.raleigh,
        customerId: ids.alex,
        kind: "LOCKOUT",
        status: "COMPLETED",
        contactPhone: "+1-919-555-0199",
        addressLine1: "105 Brooks Ave",
        city: "Raleigh",
        stateProvince: "NC",
        postalCode: "27609",
        note: "Keys locked in at the gym.",
        assignedTechnicianUserId: ids.technician,
        dispatchedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
        enRouteAt: new Date(Date.now() - 4 * 60 * 60 * 1000 + 6 * 60 * 1000),
        onSceneAt: new Date(Date.now() - 4 * 60 * 60 * 1000 + 18 * 60 * 1000),
        completedAt: new Date(Date.now() - 4 * 60 * 60 * 1000 + 26 * 60 * 1000),
      },
    ],
  });
}

seed()
  .then(async () => {
    await seedOperationalDemo();
    console.info("Seeded deterministic ShopOS demonstration data.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
