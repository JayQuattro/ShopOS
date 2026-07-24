import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export type CustomerServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class CustomerMutationFailed extends Error {
  constructor(
    public readonly reason: "customer_not_found" | "contact_not_found" | "address_not_found",
  ) {
    super("The customer mutation could not be completed.");
    this.name = "CustomerMutationFailed";
  }
}

function assertCanWrite(context: TenantContext): void {
  assertTenantAccess(context, { organizationId: context.organizationId }, "customers.write");
}

function recordAudit(
  transaction: TransactionalClient,
  args: {
    organizationId: string;
    actorUserId: string;
    requestId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
) {
  return transaction.auditEvent.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      requestId: args.requestId,
      ...(args.before !== undefined ? { before: args.before as object } : {}),
      ...(args.after !== undefined ? { after: args.after as object } : {}),
    },
  });
}

export async function updateCustomer(
  input: CustomerServiceInput & {
    customerId: string;
    displayName?: string;
    primaryEmail?: string;
    primaryPhone?: string;
    internalNotes?: string;
    customerFacingNotes?: string;
  },
): Promise<void> {
  assertCanWrite(input.context);

  await input.db.$transaction(async (transaction) => {
    const customer = await transaction.customer.findFirst({
      where: { id: input.customerId, organizationId: input.context.organizationId },
      select: { id: true, displayName: true, primaryEmail: true, primaryPhone: true },
    });
    if (!customer) throw new CustomerMutationFailed("customer_not_found");

    const data: Record<string, unknown> = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.primaryEmail !== undefined) data.primaryEmail = input.primaryEmail;
    if (input.primaryPhone !== undefined) data.primaryPhone = input.primaryPhone;
    if (input.internalNotes !== undefined) data.internalNotes = input.internalNotes;
    if (input.customerFacingNotes !== undefined)
      data.customerFacingNotes = input.customerFacingNotes;

    if (Object.keys(data).length === 0) return;

    await transaction.customer.update({ where: { id: customer.id }, data });
    await recordAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "customer.updated",
      entityType: "customer",
      entityId: customer.id,
      before: { displayName: customer.displayName },
      after: data,
    });
  });
}

export async function archiveCustomer(
  input: CustomerServiceInput & { customerId: string },
): Promise<void> {
  assertCanWrite(input.context);

  await input.db.$transaction(async (transaction) => {
    const update = await transaction.customer.updateMany({
      where: {
        id: input.customerId,
        organizationId: input.context.organizationId,
        archivedAt: null,
      },
      data: { archivedAt: new Date() },
    });
    if (update.count !== 1) throw new CustomerMutationFailed("customer_not_found");

    await recordAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "customer.archived",
      entityType: "customer",
      entityId: input.customerId,
    });
  });
}

export async function unarchiveCustomer(
  input: CustomerServiceInput & { customerId: string },
): Promise<void> {
  assertCanWrite(input.context);

  await input.db.$transaction(async (transaction) => {
    const update = await transaction.customer.updateMany({
      where: { id: input.customerId, organizationId: input.context.organizationId },
      data: { archivedAt: null },
    });
    if (update.count !== 1) throw new CustomerMutationFailed("customer_not_found");

    await recordAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "customer.unarchived",
      entityType: "customer",
      entityId: input.customerId,
    });
  });
}

// --- Contact management ---

export async function addContact(
  input: CustomerServiceInput & {
    customerId: string;
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    isPrimary?: boolean;
    notes?: string;
  },
): Promise<Readonly<{ contactId: string }>> {
  assertCanWrite(input.context);

  return input.db.$transaction(async (transaction) => {
    const customer = await transaction.customer.findFirst({
      where: { id: input.customerId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!customer) throw new CustomerMutationFailed("customer_not_found");

    // If setting as primary, clear other primaries first.
    if (input.isPrimary) {
      await transaction.customerContact.updateMany({
        where: {
          organizationId: input.context.organizationId,
          customerId: customer.id,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    const contact = await transaction.customerContact.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        customerId: customer.id,
        name: input.name,
        ...(input.role ? { role: input.role } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        isPrimary: input.isPrimary ?? false,
        ...(input.notes ? { notes: input.notes } : {}),
      },
    });

    await recordAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "customer.contact_added",
      entityType: "customer_contact",
      entityId: contact.id,
      after: { customerId: customer.id, name: input.name },
    });

    return { contactId: contact.id };
  });
}

export async function removeContact(
  input: CustomerServiceInput & { contactId: string },
): Promise<void> {
  assertCanWrite(input.context);

  await input.db.$transaction(async (transaction) => {
    const deleted = await transaction.customerContact.deleteMany({
      where: { id: input.contactId, organizationId: input.context.organizationId },
    });
    if (deleted.count !== 1) throw new CustomerMutationFailed("contact_not_found");

    await recordAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "customer.contact_removed",
      entityType: "customer_contact",
      entityId: input.contactId,
    });
  });
}

// --- Address management ---

export async function addAddress(
  input: CustomerServiceInput & {
    customerId: string;
    label: string;
    line1: string;
    line2?: string;
    city: string;
    stateProvince?: string;
    postalCode?: string;
    country?: string;
    isPrimary?: boolean;
  },
): Promise<Readonly<{ addressId: string }>> {
  assertCanWrite(input.context);

  return input.db.$transaction(async (transaction) => {
    const customer = await transaction.customer.findFirst({
      where: { id: input.customerId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!customer) throw new CustomerMutationFailed("customer_not_found");

    if (input.isPrimary) {
      await transaction.customerAddress.updateMany({
        where: {
          organizationId: input.context.organizationId,
          customerId: customer.id,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    const address = await transaction.customerAddress.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        customerId: customer.id,
        label: input.label,
        line1: input.line1,
        ...(input.line2 ? { line2: input.line2 } : {}),
        city: input.city,
        ...(input.stateProvince ? { stateProvince: input.stateProvince } : {}),
        ...(input.postalCode ? { postalCode: input.postalCode } : {}),
        country: input.country ?? "US",
        isPrimary: input.isPrimary ?? false,
      },
    });

    await recordAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "customer.address_added",
      entityType: "customer_address",
      entityId: address.id,
      after: { customerId: customer.id, label: input.label },
    });

    return { addressId: address.id };
  });
}

export async function removeAddress(
  input: CustomerServiceInput & { addressId: string },
): Promise<void> {
  assertCanWrite(input.context);

  await input.db.$transaction(async (transaction) => {
    const deleted = await transaction.customerAddress.deleteMany({
      where: { id: input.addressId, organizationId: input.context.organizationId },
    });
    if (deleted.count !== 1) throw new CustomerMutationFailed("address_not_found");

    await recordAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "customer.address_removed",
      entityType: "customer_address",
      entityId: input.addressId,
    });
  });
}
