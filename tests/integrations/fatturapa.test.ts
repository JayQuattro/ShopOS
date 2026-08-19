import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildFatturaPa,
  type EInvoiceSource,
} from "@/modules/integrations/einvoicing/einvoice-formats";
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

const IT_SOURCE: EInvoiceSource = {
  format: "fatturapa",
  invoiceNumber: "2026-IT-1001",
  issuedAt: new Date("2026-08-25T10:00:00Z"),
  currency: "EUR",
  netSubtotalMinor: 100_00n,
  discountMinor: 0n,
  taxMinor: 22_00n,
  grandMinor: 122_00n,
  vatBreakdown: [{ rateBasisPoints: 2200, basisMinor: 100_00n, amountMinor: 22_00n }],
  seller: {
    name: "Officina Rossi",
    taxId: "IT01234567890",
    street: "Via Roma 1",
    city: "Milano",
    postalCode: "20121",
    country: "IT",
  },
  buyer: {
    name: "Cliente SRL",
    taxId: "IT09876543210",
    street: "Via Verdi 2",
    city: "Roma",
    postalCode: "00184",
    country: "IT",
  },
  lines: [
    {
      description: "Cambio gomme",
      quantityMilli: 1000,
      unitPriceMinor: 100_00n,
      grossMinor: 100_00n,
      discountMinor: 0n,
      taxable: true,
      taxRateBasisPoints: 2200,
      taxInclusive: false,
      taxComponents: [],
      totalMinor: 122_00n,
    },
  ],
};

describe("fatturapa builder (#198)", () => {
  const xml = buildFatturaPa({
    ...IT_SOURCE,
    sender: { countryCode: "IT", vatNumber: "01234567890" },
    destinationCode: "0000000",
    progressive: "2026IT1001",
  });

  it("emits the transmission header with sender identity and destination code", () => {
    expect(xml).toContain('versione="FPR12"');
    expect(xml).toContain("<IdPaese>IT</IdPaese>");
    expect(xml).toContain("<IdCodice>01234567890</IdCodice>");
    expect(xml).toContain("<ProgressivoInvio>2026IT1001</ProgressivoInvio>");
    expect(xml).toContain("<FormatoTrasmissione>FPR12</FormatoTrasmissione>");
    expect(xml).toContain("<CodiceDestinatario>0000000</CodiceDestinatario>");
  });

  it("emits the document body with lines, amounts, and VAT summary", () => {
    expect(xml).toContain("<TipoDocumento>TD01</TipoDocumento>");
    expect(xml).toContain("<Divisa>EUR</Divisa>");
    expect(xml).toContain("<Data>20260825</Data>");
    expect(xml).toContain("<Numero>2026-IT-1001</Numero>");
    expect(xml).toContain("<Descrizione>Cambio gomme</Descrizione>");
    expect(xml).toContain("<PrezzoTotale>100.00</PrezzoTotale>");
    expect(xml).toContain("<AliquotaIVA>22.00</AliquotaIVA>");
    expect(xml).toContain("<ImponibileImporto>100.00</ImponibileImporto>");
    expect(xml).toContain("<Imposta>22.00</Imposta>");
  });

  it("is deterministic", () => {
    const again = buildFatturaPa({
      ...IT_SOURCE,
      sender: { countryCode: "IT", vatNumber: "01234567890" },
      destinationCode: "0000000",
      progressive: "2026IT1001",
    });
    expect(again).toBe(xml);
  });
});

async function seedItalianShop() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();
  const invoiceId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Officina Rossi",
        taxId: "IT01234567890",
        einvoiceFormat: "fatturapa",
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `it-${userId.slice(0, 8)}@example.test`,
        displayName: "Italian Clerk",
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
        permissions: ["work_orders.write", "work_orders.read", "invoices.issue"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "BUSINESS",
        displayName: "Cliente SRL",
        taxId: "IT09876543210",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-IT1",
        customerConcern: "fatturapa test",
        status: "INVOICED",
      },
    }),
    dbModule.db.invoice.create({
      data: {
        id: invoiceId,
        organizationId: orgId,
        locationId,
        workOrderId,
        number: "2026-IT-1001",
        status: "ISSUED",
        currency: "EUR",
        subtotalMinor: 100_00n,
        discountMinor: 0n,
        taxMinor: 22_00n,
        taxInclusive: false,
        totalMinor: 122_00n,
        paidMinor: 0n,
        issuedAt: new Date("2026-08-25T10:00:00Z"),
        lines: {
          create: [
            {
              id: randomUUID(),
              kind: "LABOR",
              description: "Cambio gomme",
              quantityMilli: 1000,
              unitPriceMinor: 100_00n,
              grossMinor: 100_00n,
              discountMinor: 0n,
              taxable: true,
              taxRateBasisPoints: 2200,
              taxMinor: 22_00n,
              taxInclusive: false,
              totalMinor: 122_00n,
              position: 1,
            },
          ],
        },
      },
    }),
  ]);

  const context = () =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set(["invoices.issue", "work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, invoiceId, context };
}

describe("fatturapa generation end to end (#198)", { skip: shouldSkip }, () => {
  it("derives the sender from the org tax id and stores the document", async () => {
    const service = await import("@/modules/integrations/einvoicing/einvoice-service");
    const seed = await seedItalianShop();

    const document = await service.generateEInvoice({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: seed.invoiceId,
    });
    expect(document.format).toBe("fatturapa");

    const stored = await service.getEInvoiceDocument({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: seed.invoiceId,
    });
    expect(stored.xml).toContain("<IdPaese>IT</IdPaese>");
    expect(stored.xml).toContain("<IdCodice>01234567890</IdCodice>");
    expect(stored.xml).toContain("<ProgressivoInvio>");
    expect(stored.filename).toContain("2026-IT-1001");
    expect(stored.filename).toContain(".xml");
  });

  it("refuses generation without a sender tax registration", async () => {
    const service = await import("@/modules/integrations/einvoicing/einvoice-service");
    const seed = await seedItalianShop();
    await dbModule.db.organization.update({
      where: { id: seed.orgId },
      data: { taxId: null },
    });

    await expect(
      service.generateEInvoice({
        db: dbModule.db,
        context: seed.context(),
        invoiceId: seed.invoiceId,
      }),
    ).rejects.toMatchObject({ reason: "sender_tax_id_required" });
    expect(await dbModule.db.eInvoiceDocument.count()).toBe(0);
  });
});
