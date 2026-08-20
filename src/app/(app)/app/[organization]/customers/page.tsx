import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ListSearch } from "@/components/shopos/list-search";
import { PageHeader } from "@/components/shopos/page-header";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { EmptyState } from "@/components/shopos/states";
import { humanizeToken } from "@/lib/labels";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { CustomerCreateForm } from "./customer-create-form";

export default async function CustomersPage({
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

  const query = search?.trim() ?? "";
  const customers = await db.customer.findMany({
    where: {
      organizationId: context.organizationId,
      archivedAt: null,
      ...(query
        ? {
            OR: [
              { displayName: { contains: query, mode: "insensitive" } },
              { primaryEmail: { contains: query, mode: "insensitive" } },
              { primaryPhone: { contains: query, mode: "insensitive" } },
              { organizationReference: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
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
        actions={context.permissions.has("customers.write") ? <CustomerCreateForm /> : undefined}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ListSearch
          action={`/app/${context.organizationId}/customers`}
          query={query}
          placeholder="Search name, email, phone, ref…"
        />
        <p className="text-sm text-muted-foreground">
          {customers.length} customer{customers.length === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {customers.length === 0 ? (
            query ? (
              <EmptyState
                title="No customers match your search"
                description={`Nothing found for “${query}”. Try a name, email, phone, or reference.`}
              />
            ) : (
              <EmptyState
                title="No customers yet"
                description="Add your first customer to start recording service history."
              />
            )
          ) : (
            <RecordList>
              {customers.map((c) => (
                <RecordListRow
                  key={c.id}
                  href={`/app/${context.organizationId}/customers/${c.id}`}
                  title={c.displayName}
                  description={
                    [c.organizationReference, c.primaryEmail, c.primaryPhone]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  trailing={<Badge variant="outline">{humanizeToken(c.kind)}</Badge>}
                />
              ))}
            </RecordList>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
