import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { SummaryCard } from "@/components/shopos/states";
import { db } from "@/db/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
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
        select: { id: true, displayName: true, category: true, manufacturer: true, model: true },
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
        description={`${customer.kind.toLowerCase()} customer`}
        breadcrumbs={[
          { label: "Customers", href: `/app/${context.organizationId}/customers` },
          { label: customer.displayName },
        ]}
        actions={
          context.permissions.has("customers.write") ? (
            <CustomerEditForm
              customerId={customer.id}
              initialDisplayName={customer.displayName}
              initialEmail={customer.primaryEmail ?? ""}
              initialPhone={customer.primaryPhone ?? ""}
              initialReference={customer.organizationReference ?? ""}
              initialInternalNotes={customer.internalNotes ?? ""}
              canWrite
            />
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Visits" value={String(visitCount)} />
        <SummaryCard
          label="Lifetime invoiced"
          value={
            lifetimeByCurrency.size === 0
              ? "—"
              : [...lifetimeByCurrency.entries()]
                  .map(([currency, minor]) => formatMoney(minor, currency, "en-US"))
                  .join(" · ")
          }
        />
        <SummaryCard
          label="Last visit"
          value={lastVisit ? formatDate(lastVisit.createdAt, "UTC", "en-US") : "—"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerEditForm
            customerId={customer.id}
            initialDisplayName={customer.displayName}
            initialEmail={customer.primaryEmail ?? ""}
            initialPhone={customer.primaryPhone ?? ""}
            initialReference={customer.organizationReference ?? ""}
            initialInternalNotes={customer.internalNotes ?? ""}
            canWrite={context.permissions.has("customers.write")}
          />
        </CardContent>
      </Card>

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
            <p className="font-medium">{customer.primaryEmail ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Phone</p>
            <p className="font-medium">{customer.primaryPhone ?? "—"}</p>
          </CardContent>
        </Card>
      </div>

      {customer.contacts.length > 0 || context.permissions.has("customers.write") ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Contacts</CardTitle>
            {context.permissions.has("customers.write") ? (
              <ContactForm customerId={customer.id} />
            ) : null}
          </CardHeader>
          <CardHeader>
            <CardTitle className="text-base">Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Phone</th>
                  {context.permissions.has("customers.write") ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {customer.contacts.map((c) => (
                  <tr key={c.id} className="border-b border-border/60">
                    <td className="py-3 pr-4 font-medium">
                      {c.isPrimary ? "★ " : ""}
                      {c.name}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{c.role ?? "—"}</td>
                    <td className="py-3 pr-4">{c.email ?? "—"}</td>
                    <td className="py-3 pr-4">{c.phone ?? "—"}</td>
                    {context.permissions.has("customers.write") ? (
                      <td className="py-2 pr-2">
                        <RemoveButton
                          apiPath={`/api/customers/${customer.id}/contacts/${c.id}`}
                          label={c.name}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {customer.addresses.length > 0 || context.permissions.has("customers.write") ? (
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
                    <p className="text-sm text-muted-foreground">
                      {[a.city, a.stateProvince, a.postalCode, a.country]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {customer.assets.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assets</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Asset</th>
                  <th className="py-2 pr-4 font-medium">Category</th>
                  <th className="py-2 pr-4 font-medium">Make / Model</th>
                </tr>
              </thead>
              <tbody>
                {customer.assets.map((a) => (
                  <tr key={a.id} className="border-b border-border/60">
                    <td className="py-3 pr-4 font-medium">{a.displayName}</td>
                    <td className="py-3 pr-4">
                      <Badge variant="outline">{a.category}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {[a.manufacturer, a.model].filter(Boolean).join(" ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service history</CardTitle>
        </CardHeader>
        <CardContent>
          {customer.workOrders.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No visits yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">RO #</th>
                  <th className="py-2 pr-4 font-medium">Vehicle / asset</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium text-right">Invoiced</th>
                  <th className="py-2 pr-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {customer.workOrders.map((wo) => (
                  <tr key={wo.id} className="border-b border-border/60">
                    <td className="py-3 pr-4 whitespace-nowrap font-mono text-xs tabular-nums">
                      {formatDate(wo.createdAt, "UTC", "en-US")}
                    </td>
                    <td className="py-3 pr-4 font-mono">{wo.number}</td>
                    <td className="py-3 pr-4">
                      {wo.asset?.displayName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 pr-4 capitalize">
                      {wo.status.replace(/_/g, " ").toLowerCase()}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums">
                      {wo.invoice ? (
                        <span
                          className={
                            wo.invoice.status === "PAID"
                              ? "text-success"
                              : wo.invoice.status === "VOID"
                                ? "text-muted-foreground line-through"
                                : ""
                          }
                        >
                          {formatMoney(Number(wo.invoice.totalMinor), wo.invoice.currency, "en-US")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/app/${context.organizationId}/work-orders/${wo.id}`}
                        className="text-link underline-offset-4 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
