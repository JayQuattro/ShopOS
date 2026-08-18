import type { PrismaClient } from "@/generated/prisma/client";
import { buildCustomerStatement, type CustomerStatement } from "@/modules/billing/ar-service";

export type PortalLink = Readonly<{
  organizationId: string;
  organizationName: string;
  customerId: string;
  customerName: string;
}>;

export type PortalWorkOrder = Readonly<{
  id: string;
  number: string;
  status: string;
  customerConcern: string;
  assetName: string | null;
  promisedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  trackerToken: string | null;
}>;

export type PortalInvoice = Readonly<{
  id: string;
  number: string;
  status: string;
  currency: string;
  totalMinor: bigint;
  paidMinor: bigint;
  issuedAt: Date | null;
}>;

export type PortalShopView = Readonly<{
  organization: Readonly<{
    id: string;
    name: string;
    contactPhone: string | null;
    contactEmail: string | null;
  }>;
  customer: Readonly<{ customerId: string; displayName: string; isAccountCustomer: boolean }>;
  vehicles: readonly Readonly<{ id: string; displayName: string; category: string | null }>[];
  workOrders: readonly PortalWorkOrder[];
  invoices: readonly PortalInvoice[];
  statement: CustomerStatement | null;
}>;

/**
 * Every customer record linked to this portal user. The link is resolved
 * from server-side records on each request — a session alone never implies
 * which organization or customer this viewer is (ADR 0005 pattern).
 */
export async function resolvePortalLinks(
  db: PrismaClient,
  userId: string,
): Promise<readonly PortalLink[]> {
  const customers = await db.customer.findMany({
    where: { portalUserId: userId, archivedAt: null },
    select: {
      id: true,
      displayName: true,
      organizationId: true,
      organization: { select: { name: true, status: true } },
    },
    orderBy: { organization: { name: "asc" } },
    take: 20,
  });

  return customers
    .filter((customer) => customer.organization.status === "ACTIVE")
    .map((customer) => ({
      organizationId: customer.organizationId,
      organizationName: customer.organization.name,
      customerId: customer.id,
      customerName: customer.displayName,
    }));
}

/**
 * The one customer record this user is linked to inside an organization.
 * Scoped from the first query — never fetch globally and check afterwards.
 */
export async function resolvePortalCustomer(
  db: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<Readonly<{
  customerId: string;
  displayName: string;
  isAccountCustomer: boolean;
}> | null> {
  const customer = await db.customer.findFirst({
    where: { portalUserId: userId, organizationId, archivedAt: null },
    select: {
      id: true,
      displayName: true,
      isAccountCustomer: true,
      organization: { select: { status: true } },
    },
  });
  if (!customer || customer.organization.status !== "ACTIVE") return null;

  return {
    customerId: customer.id,
    displayName: customer.displayName,
    isAccountCustomer: customer.isAccountCustomer,
  };
}

/**
 * A customer's own view of one shop: their vehicles, their work orders with
 * live tracker links, their issued invoices, and their statement. Every
 * query is scoped by organization + the linked customer record.
 */
export async function getPortalShopView(
  db: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<PortalShopView | null> {
  const customer = await resolvePortalCustomer(db, userId, organizationId);
  if (!customer) return null;

  const [organization, vehicles, workOrders, invoices, statement] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, contactPhone: true, contactEmail: true },
    }),
    db.asset.findMany({
      where: { organizationId, customerId: customer.customerId, status: { not: "SOLD" } },
      orderBy: { displayName: "asc" },
      take: 50,
      select: { id: true, displayName: true, category: true },
    }),
    db.workOrder.findMany({
      where: { organizationId, customerId: customer.customerId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        number: true,
        status: true,
        customerConcern: true,
        promisedAt: true,
        completedAt: true,
        createdAt: true,
        asset: { select: { displayName: true } },
        trackerLink: { select: { token: true } },
      },
    }),
    db.invoice.findMany({
      where: {
        organizationId,
        workOrder: { customerId: customer.customerId },
        status: { in: ["ISSUED", "PAID"] },
      },
      orderBy: { issuedAt: "desc" },
      take: 25,
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        totalMinor: true,
        paidMinor: true,
        issuedAt: true,
      },
    }),
    buildCustomerStatement(db, organizationId, customer.customerId, new Date()),
  ]);

  if (!organization) return null;

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      contactPhone: organization.contactPhone,
      contactEmail: organization.contactEmail,
    },
    customer,
    vehicles,
    workOrders: workOrders.map((workOrder) => ({
      id: workOrder.id,
      number: workOrder.number,
      status: workOrder.status,
      customerConcern: workOrder.customerConcern,
      assetName: workOrder.asset?.displayName ?? null,
      promisedAt: workOrder.promisedAt,
      completedAt: workOrder.completedAt,
      createdAt: workOrder.createdAt,
      trackerToken: workOrder.trackerLink?.token ?? null,
    })),
    invoices,
    statement,
  };
}
