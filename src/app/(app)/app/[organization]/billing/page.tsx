import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSearch } from "@/components/shopos/list-search";
import { PageHeader } from "@/components/shopos/page-header";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { EmptyState } from "@/components/shopos/states";
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
 * statement button.
 */
export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { organization } = await params;
  const { q: search } = await searchParams;
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

  const query = search?.trim().toLowerCase() ?? "";
  const shownBalances = query
    ? balances.filter((balance) => balance.customerName.toLowerCase().includes(query))
    : balances;

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
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ListSearch
              action={`/app/${orgId}/billing`}
              query={search?.trim() ?? ""}
              placeholder="Search customer…"
            />
            <p className="text-sm text-muted-foreground">
              {shownBalances.length} customer{shownBalances.length === 1 ? "" : "s"} with balance ·{" "}
              {[...totalByCurrency.entries()]
                .map(([currency, minor]) => money(minor, currency))
                .join(" · ")}
            </p>
          </div>

          <Card>
            <CardContent className="p-0">
              {shownBalances.length === 0 ? (
                query ? (
                  <EmptyState
                    title="No balances match your search"
                    description={`Nothing found for “${search?.trim()}”.`}
                  />
                ) : (
                  <EmptyState
                    title="No open balances"
                    description="Every issued invoice is paid in full."
                  />
                )
              ) : (
                <RecordList>
                  {shownBalances.map((balance) => {
                    const aging = [
                      { label: "current", minor: balance.currentMinor },
                      { label: "31–60", minor: balance.days31to60Minor },
                      { label: "61–90", minor: balance.days61to90Minor },
                      { label: "90+", minor: balance.over90Minor },
                    ].filter((bucket) => bucket.minor > 0n);
                    return (
                      <RecordListRow
                        key={`${balance.customerId}-${balance.currency}`}
                        title={
                          <>
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
                          </>
                        }
                        description={
                          aging.length === 0
                            ? "All current"
                            : aging
                                .map(
                                  (bucket) =>
                                    `${bucket.label} ${money(bucket.minor, balance.currency)}`,
                                )
                                .join(" · ")
                        }
                        trailing={
                          <>
                            <span className="font-mono text-sm font-semibold tabular-nums">
                              {money(balance.balanceMinor, balance.currency)}
                            </span>
                            <Button variant="outline" size="sm" asChild>
                              <a
                                href={`/print/${orgId}/statement/${balance.customerId}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Statement
                              </a>
                            </Button>
                          </>
                        }
                      />
                    );
                  })}
                </RecordList>
              )}
            </CardContent>
          </Card>

          {openDeposits.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
                  Held deposits — money taken before invoicing
                </p>
                <RecordList>
                  {openDeposits.map((deposit) => (
                    <RecordListRow
                      key={deposit.id}
                      href={`/app/${orgId}/work-orders/${deposit.workOrderId}`}
                      title={`#${deposit.workOrderNumber} · ${deposit.customerName}`}
                      description={formatDateTime(deposit.receivedAt, "UTC", "en-US")}
                      trailing={
                        <span className="font-mono text-sm tabular-nums">
                          {money(deposit.amountMinor, deposit.currency)}
                        </span>
                      }
                    />
                  ))}
                </RecordList>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              Balances need payment-record access. Account customers are still listed below.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
            Account customers — billed on statement instead of pay-at-pickup
          </p>
          {accountCustomers.length === 0 ? (
            <EmptyState
              title="No account customers yet"
              description="Toggle one on from their customer profile page."
            />
          ) : (
            <RecordList>
              {accountCustomers.map((customer) => (
                <RecordListRow
                  key={customer.id}
                  title={
                    <Link
                      href={`/app/${orgId}/customers/${customer.id}`}
                      className="text-link underline-offset-4 hover:underline"
                    >
                      {customer.displayName}
                    </Link>
                  }
                  trailing={
                    canManageCustomers ? (
                      <AccountToggle
                        orgId={orgId}
                        customerId={customer.id}
                        isAccount={customer.isAccountCustomer}
                      />
                    ) : null
                  }
                />
              ))}
            </RecordList>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
