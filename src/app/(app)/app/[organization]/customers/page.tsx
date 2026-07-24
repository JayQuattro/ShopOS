import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";

export default async function CustomersPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const context = await getRequestContext();
  const { organization } = await params;
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const customers = await db.customer.findMany({
    where: {
      organizationId: context.organizationId,
      archivedAt: null,
    },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      kind: true,
      displayName: true,
      organizationReference: true,
      primaryEmail: true,
      primaryPhone: true,
    },
    take: 100,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Individual and business customer records."
        breadcrumbs={[{ label: "Customers" }]}
      />

      <Card>
        <CardContent className="p-0">
          {customers.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">No customers yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Ref</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{c.displayName}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{c.kind.toLowerCase()}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {c.organizationReference ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.primaryEmail ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.primaryPhone ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/${context.organizationId}/customers/${c.id}`}
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
