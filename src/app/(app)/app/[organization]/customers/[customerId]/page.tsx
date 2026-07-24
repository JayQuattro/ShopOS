import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ organization: string; customerId: string }>;
}) {
  const context = await getRequestContext();
  const { organization, customerId } = await params;
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
        take: 10,
        select: {
          id: true,
          number: true,
          status: true,
          customerConcern: true,
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={customer.displayName}
        description={`${customer.kind.toLowerCase()} customer`}
        breadcrumbs={[
          { label: "Customers", href: `/app/${context.organizationId}/customers` },
          { label: customer.displayName },
        ]}
      />

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

      {customer.contacts.length > 0 ? (
        <Card>
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
                  </tr>
                ))}
              </tbody>
            </table>
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

      {customer.workOrders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent work orders</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">RO #</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Concern</th>
                  <th className="py-2 pr-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {customer.workOrders.map((wo) => (
                  <tr key={wo.id} className="border-b border-border/60">
                    <td className="py-3 pr-4 font-mono">{wo.number}</td>
                    <td className="py-3 pr-4 capitalize">
                      {wo.status.replace(/_/g, " ").toLowerCase()}
                    </td>
                    <td className="py-3 pr-4 max-w-md truncate text-muted-foreground">
                      {wo.customerConcern}
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
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
