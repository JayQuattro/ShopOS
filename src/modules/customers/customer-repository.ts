import type { CustomerKind, PrismaClient } from "@/generated/prisma/client";
import {
  assertTenantAccess,
  TenantAccessDenied,
  type TenantContext,
} from "@/modules/tenancy/policy";

export type CustomerSummary = Readonly<{
  id: string;
  kind: CustomerKind;
  displayName: string;
  organizationReference: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
}>;

export type CreateCustomerInput = Readonly<{
  kind: CustomerKind;
  displayName: string;
  organizationReference?: string;
  primaryEmail?: string;
  primaryPhone?: string;
}>;

export type ListCustomersInput = Readonly<{
  search?: string;
}>;

/**
 * Tenant-scoped customer repository.
 *
 * Every query is scoped by the resolved `TenantContext.organizationId` on the
 * first database access — it never fetches globally and filters afterward
 * (ADR 0002). Organization is always derived from the context on create,
 * never from untrusted input. Customers are organization-scoped (no location),
 * so location checks are not applied here; the pattern is established for the
 * location-scoped repositories that follow.
 */
export class CustomerRepository {
  constructor(private readonly deps: Readonly<{ db: PrismaClient; context: TenantContext }>) {}

  async findById(id: string): Promise<CustomerSummary | null> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "customers.read",
    );

    const customer = await this.deps.db.customer.findFirst({
      where: {
        id,
        organizationId: this.deps.context.organizationId,
      },
      select: {
        id: true,
        kind: true,
        displayName: true,
        organizationReference: true,
        primaryEmail: true,
        primaryPhone: true,
      },
    });

    return customer ?? null;
  }

  async list(input: ListCustomersInput = {}): Promise<ReadonlyArray<CustomerSummary>> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "customers.read",
    );

    const customers = await this.deps.db.customer.findMany({
      where: {
        organizationId: this.deps.context.organizationId,
        ...(input.search
          ? { displayName: { contains: input.search, mode: "insensitive" as const } }
          : {}),
      },
      select: {
        id: true,
        kind: true,
        displayName: true,
        organizationReference: true,
        primaryEmail: true,
        primaryPhone: true,
      },
      orderBy: { displayName: "asc" },
    });

    return customers;
  }

  async create(input: CreateCustomerInput): Promise<CustomerSummary> {
    assertTenantAccess(
      { ...this.deps.context },
      { organizationId: this.deps.context.organizationId },
      "customers.write",
    );

    // Organization is derived from the verified context, never from input.
    const data: Record<string, unknown> = {
      organizationId: this.deps.context.organizationId,
      kind: input.kind,
      displayName: input.displayName,
    };
    if (input.organizationReference !== undefined) {
      data.organizationReference = input.organizationReference;
    }
    if (input.primaryEmail !== undefined) {
      data.primaryEmail = input.primaryEmail;
    }
    if (input.primaryPhone !== undefined) {
      data.primaryPhone = input.primaryPhone;
    }

    const customer = await this.deps.db.customer.create({
      data: data as Parameters<typeof this.deps.db.customer.create>[0]["data"],
      select: {
        id: true,
        kind: true,
        displayName: true,
        organizationReference: true,
        primaryEmail: true,
        primaryPhone: true,
      },
    });

    return customer;
  }
}

export { TenantAccessDenied };
