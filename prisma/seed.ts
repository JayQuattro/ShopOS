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
  });
}

seed()
  .then(() => {
    console.info("Seeded deterministic ShopOS demonstration data.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
