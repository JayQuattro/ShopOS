import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const context = await getRequestContext();
  const { organization } = await params;
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const assets = await db.asset.findMany({
    where: {
      organizationId: context.organizationId,
      status: { not: "SOLD" },
    },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      category: true,
      manufacturer: true,
      model: true,
      modelYear: true,
      status: true,
      customer: { select: { id: true, displayName: true } },
    },
    take: 100,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Assets"
        description="Serviced vehicles, equipment, and customer-owned items."
        breadcrumbs={[{ label: "Assets" }]}
      />

      <Card>
        <CardContent className="p-0">
          {assets.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">No assets yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Make / Model</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{a.displayName}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{a.category}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {[a.modelYear, a.manufacturer, a.model].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/${context.organizationId}/customers/${a.customer.id}`}
                        className="text-link underline-offset-4 hover:underline"
                      >
                        {a.customer.displayName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/${context.organizationId}/assets/${a.id}`}
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
