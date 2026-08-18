import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDateTime, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listCustomerBalances } from "@/modules/billing/ar-service";
import { listOpenDeposits } from "@/modules/billing/deposit-service";
import { AccountToggle } from "./account-toggle";

export const dynamic = "force-dynamic";

function money(minor: bigint, currency: string): string {
  return formatMoney(Number(minor), currency, "en-US");
}

/**
 * Who owes what: open balances by customer with aging from each invoice's
 * issue date, account-customer flags, and printable statements. Statement
 * detail (invoices + payments with a running balance) lives behind the
 * print link.
 */
export default async function BillingPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  // Balances need money sight; the page degrades to the account list without it.
  const canSeeMoney = context.permissions.has("payments.record");
  const [balances, openDeposits] = canSeeMoney
    ? await Promise.all([listCustomerBalances({ db, context }), listOpenDeposits({ db, context })])
    : [[], []];

  const accountCustomers = await db.customer.findMany({
    where: { organizationId: context.organizationId, isAccountCustomer: true, archivedAt: null },
    select: { id: true, displayName: true, isAccountCustomer: true },
    orderBy: { displayName: "asc" },
    take: 100,
  });
  const canManageCustomers = context.permissions.has("customers.write");
  const orgId = context.organizationId;

  const totalByCurrency = new Map<string, bigint>();
  for (const balance of balances) {
    totalByCurrency.set(
      balance.currency,
      (totalByCurrency.get(balance.currency) ?? 0n) + balance.balanceMinor,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Open balances, aging, and account customers — who owes what."
        breadcrumbs={[{ label: "Billing" }]}
      />

      {canSeeMoney ? (
        <Card>
          <CardContent className="p-0">
            {balances.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No open balances — every issued invoice is paid in full.
              </p>
            ) : (
              <>
                <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
                  {balances.length} customer{balances.length === 1 ? "" : "s"} with balance ·{" "}
                  {[...totalByCurrency.entries()]
                    .map(([currency, minor]) => money(minor, currency))
                    .join(" · ")}
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium">Balance</th>
                      <th className="px-4 py-3 font-medium">Current</th>
                      <th className="px-4 py-3 font-medium">31–60</th>
                      <th className="px-4 py-3 font-medium">61–90</th>
                      <th className="px-4 py-3 font-medium">90+</th>
                      <th className="px-4 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((balance) => (
                      <tr
                        key={`${balance.customerId}-${balance.currency}`}
                        className="border-b border-border/60 hover:bg-muted/30"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/app/${orgId}/customers/${balance.customerId}`}
                            className="text-link underline-offset-4 hover:underline"
                          >
                            {balance.customerName}
                          </Link>
                          {balance.isAccountCustomer ? (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              account
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {money(balance.balanceMinor, balance.currency)}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                          {money(balance.currentMinor, balance.currency)}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                          {money(balance.days31to60Minor, balance.currency)}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                          {money(balance.days61to90Minor, balance.currency)}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                          {money(balance.over90Minor, balance.currency)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/print/${orgId}/statement/${balance.customerId}`}
                            className="text-link underline-offset-4 hover:underline"
                            target="_blank"
                          >
                            Statement
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              Balances need payment-record access. Account customers are still listed below.
            </p>
          </CardContent>
        </Card>
      )}

      {canSeeMoney && openDeposits.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
              Held deposits — money taken before invoicing
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Taken</th>
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {openDeposits.map((deposit) => (
                  <tr key={deposit.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(deposit.receivedAt, "UTC", "en-US")}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/${orgId}/work-orders/${deposit.workOrderId}`}
                        className="font-mono text-link underline-offset-4 hover:underline"
                      >
                        {deposit.workOrderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{deposit.customerName}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {money(deposit.amountMinor, deposit.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
            Account customers — billed on statement instead of pay-at-pickup
          </p>
          {accountCustomers.length === 0 ? (
            <p className="px-6 py-6 text-center text-sm text-muted-foreground">
              No account customers yet. Toggle one on from their customer profile page.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {accountCustomers.map((customer) => (
                <li
                  key={customer.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <Link
                    href={`/app/${orgId}/customers/${customer.id}`}
                    className="text-link underline-offset-4 hover:underline"
                  >
                    {customer.displayName}
                  </Link>
                  {canManageCustomers ? (
                    <AccountToggle orgId={orgId} customerId={customer.id} isAccount={true} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
