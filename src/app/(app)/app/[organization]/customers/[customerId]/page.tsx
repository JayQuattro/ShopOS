import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { PageSection } from "@/components/shopos/section";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { EmptyState } from "@/components/shopos/states";
import { WorkOrderStatusBadge } from "@/components/shopos/status-badge";
import { humanizeToken } from "@/lib/labels";
import { db } from "@/db/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { formatAddressForDisplay } from "@/i18n/address-formats";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { AccountToggle } from "../../billing/account-toggle";
import { AddAssetForm } from "./add-asset-form";
import { ContactForm } from "./contact-form";
import { AddressForm } from "./address-form";
import { CustomerEditForm } from "./customer-edit-form";
import { RemoveButton } from "./remove-button";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ organization: string; customerId: string }>;
}) {
  const { organization, customerId } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const customer = await db.customer.findFirst({
    where: { id: customerId, organizationId: context.organizationId },
    include: {
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
        select: { id: true, name: true, role: true, email: true, phone: true, isPrimary: true },
      },
      addresses: {
        orderBy: [{ isPrimary: "desc" }],
        select: {
          id: true,
          label: true,
          line1: true,
          line2: true,
          city: true,
          stateProvince: true,
          postalCode: true,
          country: true,
          isPrimary: true,
        },
      },
      assets: {
        where: { status: { not: "SOLD" } },
        orderBy: { displayName: "asc" },
        select: {
          id: true,
          displayName: true,
          category: true,
          manufacturer: true,
          model: true,
          modelYear: true,
        },
      },
      workOrders: {
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          number: true,
          status: true,
          customerConcern: true,
          createdAt: true,
          promisedAt: true,
          asset: { select: { displayName: true } },
          invoice: {
            select: {
              status: true,
              currency: true,
              totalMinor: true,
              paidMinor: true,
            },
          },
        },
      },
    },
  });

  if (!customer) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Customer not found.</p>
          <Link
            href={`/app/${context.organizationId}/customers`}
            className="text-link underline-offset-4 hover:underline"
          >
            ← Back to customers
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Lifetime stats: visits, invoiced (non-void), and last visit.
  const [visitCount, invoicedRows, lastVisit] = await Promise.all([
    db.workOrder.count({
      where: { organizationId: context.organizationId, customerId: customer.id },
    }),
    db.invoice.findMany({
      where: {
        organizationId: context.organizationId,
        workOrder: { customerId: customer.id },
        status: { not: "VOID" },
      },
      select: { currency: true, totalMinor: true },
    }),
    db.workOrder.findFirst({
      where: { organizationId: context.organizationId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const lifetimeByCurrency = new Map<string, number>();
  for (const row of invoicedRows) {
    lifetimeByCurrency.set(
      row.currency,
      (lifetimeByCurrency.get(row.currency) ?? 0) + Number(row.totalMinor),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={customer.displayName}
        description={`${humanizeToken(customer.kind)} customer${customer.isAccountCustomer ? " · billed on account" : ""}`}
        breadcrumbs={[
          { label: "Customers", href: `/app/${context.organizationId}/customers` },
          { label: customer.displayName },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {context.permissions.has("work_orders.write") ? (
              <Button asChild>
                <Link
                  href={`/app/${context.organizationId}/work-orders?new=1&customer=${customer.id}`}
                >
                  New work order
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <a
                href={`/print/${context.organizationId}/customer/${customer.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Print
              </a>
            </Button>
            {context.permissions.has("customers.write") ? (
              <CustomerEditForm
                customerId={customer.id}
                initialDisplayName={customer.displayName}
                initialEmail={customer.primaryEmail ?? ""}
                initialPhone={customer.primaryPhone ?? ""}
                initialReference={customer.organizationReference ?? ""}
                initialTaxId={customer.taxId ?? ""}
                initialInternalNotes={customer.internalNotes ?? ""}
                canWrite
              />
            ) : null}
          </div>
        }
      />

      <PageSection id="overview" title="Overview">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Visits</p>
              <p className="text-lg font-semibold tabular-nums">{visitCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Billing</p>
              <div className="mt-0.5">
                {context.permissions.has("customers.write") ? (
                  <AccountToggle
                    orgId={context.organizationId}
                    customerId={customer.id}
                    isAccount={customer.isAccountCustomer}
                  />
                ) : (
                  <p className="text-lg font-semibold">
                    {customer.isAccountCustomer ? "On account" : "Pay at pickup"}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Lifetime invoiced</p>
              <p className="text-lg font-semibold tabular-nums">
                {lifetimeByCurrency.size === 0
                  ? "—"
                  : [...lifetimeByCurrency.entries()]
                      .map(([currency, minor]) => formatMoney(minor, currency, "en-US"))
                      .join(" · ")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Last visit</p>
              <p className="text-lg font-semibold tabular-nums">
                {lastVisit ? formatDate(lastVisit.createdAt, "UTC", "en-US") : "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Reference</p>
              <p className="font-mono font-medium">{customer.organizationReference ?? "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Email</p>
              {customer.primaryEmail ? (
                <a
                  href={`mailto:${customer.primaryEmail}`}
                  className="font-medium text-link underline-offset-4 hover:underline"
                >
                  {customer.primaryEmail}
                </a>
              ) : (
                <p className="font-medium">—</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Phone</p>
              {customer.primaryPhone ? (
                <a
                  href={`tel:${customer.primaryPhone}`}
                  className="font-medium text-link underline-offset-4 hover:underline"
                >
                  {customer.primaryPhone}
                </a>
              ) : (
                <p className="font-medium">—</p>
              )}
            </CardContent>
          </Card>
        </div>
      </PageSection>

      {customer.contacts.length > 0 || context.permissions.has("customers.write") ? (
        <PageSection id="contacts" title="Contacts" description="People to call at this account.">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Contacts</CardTitle>
              {context.permissions.has("customers.write") ? (
                <ContactForm customerId={customer.id} />
              ) : null}
            </CardHeader>
            {customer.contacts.length > 0 ? (
              <CardContent className="p-0">
                <RecordList>
                  {customer.contacts.map((c) => (
                    <RecordListRow
                      key={c.id}
                      title={
                        <>
                          {c.name}
                          {c.isPrimary ? (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              primary
                            </Badge>
                          ) : null}
                        </>
                      }
                      description={
                        [c.role, c.phone, c.email].filter(Boolean).join(" · ") || undefined
                      }
                      trailing={
                        context.permissions.has("customers.write") ? (
                          <RemoveButton
                            apiPath={`/api/customers/${customer.id}/contacts/${c.id}`}
                            label={c.name}
                          />
                        ) : null
                      }
                    />
                  ))}
                </RecordList>
              </CardContent>
            ) : (
              <CardContent>
                <p className="text-sm text-muted-foreground">No additional contacts yet.</p>
              </CardContent>
            )}
          </Card>
        </PageSection>
      ) : null}

      {customer.addresses.length > 0 || context.permissions.has("customers.write") ? (
        <PageSection id="addresses" title="Addresses">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Addresses</CardTitle>
              {context.permissions.has("customers.write") ? (
                <AddressForm customerId={customer.id} />
              ) : null}
            </CardHeader>
            <CardContent>
              {customer.addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No addresses yet.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {customer.addresses.map((a) => (
                    <div key={a.id} className="rounded-md border border-border p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        {a.isPrimary ? "★ " : ""}
                        {a.label}
                      </p>
                      <p className="text-sm">{a.line1}</p>
                      {a.line2 ? <p className="text-sm">{a.line2}</p> : null}
                      <p className="text-sm text-muted-foreground">{formatAddressForDisplay(a)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </PageSection>
      ) : null}

      <PageSection id="vehicles" title="Vehicles & assets">
        {context.permissions.has("customers.write") ? (
          <AddAssetForm customerId={customer.id} />
        ) : null}
        <Card>
          {customer.assets.length > 0 ? (
            <CardContent className="p-0">
              <RecordList>
                {customer.assets.map((a) => (
                  <RecordListRow
                    key={a.id}
                    href={`/app/${context.organizationId}/assets/${a.id}`}
                    title={a.displayName}
                    description={
                      [a.modelYear, a.manufacturer, a.model].filter(Boolean).join(" ") || undefined
                    }
                    trailing={<Badge variant="outline">{humanizeToken(a.category)}</Badge>}
                  />
                ))}
              </RecordList>
            </CardContent>
          ) : (
            <CardContent>
              <EmptyState
                title="No vehicles yet"
                description="Add this customer's first vehicle above, then start a work order from it."
              />
            </CardContent>
          )}
        </Card>
      </PageSection>

      <PageSection
        id="history"
        title="Service history"
        description="Last 25 visits. Tap a row to open the work order."
      >
        <Card>
          {customer.workOrders.length === 0 ? (
            <CardContent>
              <EmptyState
                title="No visits yet"
                description="Start the first work order with the button up top."
              />
            </CardContent>
          ) : (
            <CardContent className="p-0">
              <RecordList>
                {customer.workOrders.map((wo) => (
                  <RecordListRow
                    key={wo.id}
                    href={`/app/${context.organizationId}/work-orders/${wo.id}`}
                    title={wo.asset?.displayName ?? "No vehicle"}
                    description={[
                      `#${wo.number}`,
                      formatDate(wo.createdAt, "UTC", "en-US"),
                      wo.customerConcern?.trim() || undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    trailing={
                      <>
                        {wo.invoice ? (
                          <span
                            className={
                              wo.invoice.status === "PAID"
                                ? "font-mono text-sm tabular-nums text-success"
                                : wo.invoice.status === "VOID"
                                  ? "font-mono text-sm tabular-nums text-muted-foreground line-through"
                                  : "font-mono text-sm tabular-nums"
                            }
                          >
                            {formatMoney(
                              Number(wo.invoice.totalMinor),
                              wo.invoice.currency,
                              "en-US",
                            )}
                          </span>
                        ) : null}
                        <WorkOrderStatusBadge status={wo.status} />
                      </>
                    }
                  />
                ))}
              </RecordList>
            </CardContent>
          )}
        </Card>
      </PageSection>
    </div>
  );
}
