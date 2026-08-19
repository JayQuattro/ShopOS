import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type ArServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class ArFailed extends Error {
  constructor(public readonly reason: "customer_not_found") {
    super("The billing operation could not be completed.");
    this.name = "ArFailed";
  }
}

export type CustomerBalance = Readonly<{
  customerId: string;
  customerName: string;
  isAccountCustomer: boolean;
  currency: string;
  balanceMinor: bigint;
  /** Outstanding amount by aging bucket, from the invoice issue date. */
  currentMinor: bigint;
  days31to60Minor: bigint;
  days61to90Minor: bigint;
  over90Minor: bigint;
}>;

export type StatementLine = Readonly<{
  kind: "invoice" | "payment" | "refund";
  date: Date;
  label: string;
  reference: string | null;
  amountMinor: bigint;
  currency: string;
  runningBalanceMinor: bigint;
}>;

export type CustomerStatement = Readonly<{
  customerId: string;
  customerName: string;
  isAccountCustomer: boolean;
  asOf: Date;
  currency: string;
  lines: readonly StatementLine[];
  balanceMinor: bigint;
}>;

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketFor(
  issuedAt: Date,
  asOf: Date,
): keyof Pick<
  CustomerBalance,
  "currentMinor" | "days31to60Minor" | "days61to90Minor" | "over90Minor"
> {
  const days = Math.floor((asOf.getTime() - issuedAt.getTime()) / DAY_MS);
  if (days <= 30) return "currentMinor";
  if (days <= 60) return "days31to60Minor";
  if (days <= 90) return "days61to90Minor";
  return "over90Minor";
}

/**
 * Open balances per customer (and currency): issued invoices minus recorded
 * payments, aged from each invoice's issue date. Customers with nothing
 * outstanding don't appear. `asOf` is injected so tests freeze time.
 */
export async function listCustomerBalances(
  input: ArServiceInput & { asOf?: Date },
): Promise<readonly CustomerBalance[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  const asOf = input.asOf ?? new Date();

  const invoices = await input.db.invoice.findMany({
    where: {
      organizationId: input.context.organizationId,
      // Outstanding money lives on issued and partially paid invoices; PAID
      // and VOID carry nothing and DRAFT hasn't been presented.
      status: { in: ["ISSUED", "PARTIALLY_PAID"] },
      issuedAt: { lte: asOf },
    },
    select: {
      id: true,
      totalMinor: true,
      paidMinor: true,
      currency: true,
      issuedAt: true,
      workOrder: {
        select: {
          customerId: true,
          customer: { select: { displayName: true, isAccountCustomer: true } },
        },
      },
    },
  });

  const byCustomer = new Map<
    string,
    {
      name: string;
      isAccountCustomer: boolean;
      currencies: Map<string, { balance: bigint; buckets: Record<string, bigint> }>;
    }
  >();

  for (const invoice of invoices) {
    const outstanding = invoice.totalMinor - invoice.paidMinor;
    if (outstanding <= 0n) continue;

    const customer = invoice.workOrder.customer;
    let entry = byCustomer.get(invoice.workOrder.customerId);
    if (!entry) {
      entry = {
        name: customer.displayName,
        isAccountCustomer: customer.isAccountCustomer,
        currencies: new Map(),
      };
      byCustomer.set(invoice.workOrder.customerId, entry);
    }
    let currency = entry.currencies.get(invoice.currency);
    if (!currency) {
      currency = {
        balance: 0n,
        buckets: { currentMinor: 0n, days31to60Minor: 0n, days61to90Minor: 0n, over90Minor: 0n },
      };
      entry.currencies.set(invoice.currency, currency);
    }
    currency.balance += outstanding;
    // The where clause above filters out invoices without an issue date.
    const bucket = currency.buckets[bucketFor(invoice.issuedAt!, asOf)] ?? 0n;
    currency.buckets[bucketFor(invoice.issuedAt!, asOf)] = bucket + outstanding;
  }

  const balances: CustomerBalance[] = [];
  for (const [customerId, entry] of byCustomer) {
    for (const [currency, amounts] of entry.currencies) {
      balances.push({
        customerId,
        customerName: entry.name,
        isAccountCustomer: entry.isAccountCustomer,
        currency,
        balanceMinor: amounts.balance,
        currentMinor: amounts.buckets.currentMinor!,
        days31to60Minor: amounts.buckets.days31to60Minor!,
        days61to90Minor: amounts.buckets.days61to90Minor!,
        over90Minor: amounts.buckets.over90Minor!,
      });
    }
  }
  return balances.sort((a, b) => Number(b.balanceMinor - a.balanceMinor));
}

/**
 * A customer's open statement: issued invoices (charges) and recorded
 * payments (credits) in date order with a running balance, as of a moment.
 */
export async function getCustomerStatement(
  input: ArServiceInput & { customerId: string; asOf?: Date },
): Promise<CustomerStatement | null> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  return buildCustomerStatement(
    input.db,
    input.context.organizationId,
    input.customerId,
    input.asOf ?? new Date(),
  );
}

/**
 * Statement core shared by staff (tenant-permissioned) and the customer
 * portal (identity-linked). Callers must have already proven the viewer's
 * right to see this customer's money.
 */
export async function buildCustomerStatement(
  db: PrismaClient,
  organizationId: string,
  customerId: string,
  asOf: Date,
): Promise<CustomerStatement | null> {
  const customer = await db.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true, displayName: true, isAccountCustomer: true },
  });
  if (!customer) throw new ArFailed("customer_not_found");

  const [invoices, payments, refunds] = await Promise.all([
    db.invoice.findMany({
      where: {
        organizationId,
        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
        issuedAt: { lte: asOf },
        workOrder: { customerId: customer.id },
      },
      select: {
        id: true,
        number: true,
        currency: true,
        totalMinor: true,
        paidMinor: true,
        issuedAt: true,
        workOrder: { select: { number: true, poNumber: true } },
      },
    }),
    db.payment.findMany({
      where: {
        organizationId,
        receivedAt: { lte: asOf },
        invoice: {
          status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          workOrder: { customerId: customer.id },
        },
      },
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        method: true,
        reference: true,
        receivedAt: true,
        invoice: { select: { number: true } },
      },
    }),
    db.refund.findMany({
      where: {
        organizationId,
        refundedAt: { lte: asOf },
        invoice: { workOrder: { customerId: customer.id } },
      },
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        reason: true,
        refundedAt: true,
        invoice: { select: { number: true } },
      },
    }),
  ]);

  type Draft = Omit<StatementLine, "runningBalanceMinor">;
  const drafts: Draft[] = [
    ...refunds.map<Draft>((refund) => ({
      kind: "refund",
      date: refund.refundedAt,
      label: `Refund on ${refund.invoice!.number}${refund.reason ? ` — ${refund.reason}` : ""}`,
      reference: null,
      // A refund adds back to the balance, like a charge in reverse.
      amountMinor: refund.amountMinor,
      currency: refund.currency,
    })),
    ...invoices.map<Draft>((invoice) => ({
      kind: "invoice",
      date: invoice.issuedAt!, // filtered to issued invoices above
      label: `Invoice ${invoice.number}${invoice.workOrder.poNumber ? ` · PO ${invoice.workOrder.poNumber}` : ""}`,
      reference: invoice.workOrder.number,
      amountMinor: invoice.totalMinor,
      currency: invoice.currency,
    })),
    ...payments.map<Draft>((payment) => ({
      kind: "payment",
      date: payment.receivedAt,
      label: `Payment (${payment.method.toLowerCase()}) on ${payment.invoice!.number}`,
      reference: payment.reference,
      amountMinor: -payment.amountMinor,
      currency: payment.currency,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Statement per currency keeps math honest in multi-currency shops.
  const currencies = [...new Set(drafts.map((draft) => draft.currency))];
  const currency = currencies.length > 0 ? currencies[0]! : "USD";
  const lines = drafts.filter((draft) => draft.currency === currency);

  let running = 0n;
  const statementLines: StatementLine[] = lines.map((line) => {
    running += line.amountMinor;
    return { ...line, runningBalanceMinor: running };
  });

  return {
    customerId: customer.id,
    customerName: customer.displayName,
    isAccountCustomer: customer.isAccountCustomer,
    asOf,
    currency,
    lines: statementLines,
    balanceMinor: running,
  };
}

/**
 * Flags a customer as an on-account (billed monthly) customer. Audit-logged;
 * the flag changes billing expectations, never access or totals.
 */
export async function setCustomerAccount(
  input: ArServiceInput & { customerId: string; isAccountCustomer: boolean },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "customers.write",
  );

  await input.db.$transaction(async (transaction) => {
    const before = await transaction.customer.findFirst({
      where: { id: input.customerId, organizationId: input.context.organizationId },
      select: { id: true, isAccountCustomer: true },
    });
    if (!before) throw new ArFailed("customer_not_found");

    await transaction.customer.update({
      where: { id: before.id },
      data: { isAccountCustomer: input.isAccountCustomer },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        actorUserId: input.context.actorId,
        action: "customer.account_flag_updated",
        entityType: "customer",
        entityId: before.id,
        requestId: input.context.requestId,
        before: { isAccountCustomer: before.isAccountCustomer },
        after: { isAccountCustomer: input.isAccountCustomer },
      },
    });
  });
}
