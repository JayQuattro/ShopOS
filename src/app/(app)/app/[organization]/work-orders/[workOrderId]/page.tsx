import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { EmptyState } from "@/components/shopos/states";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { WorkOrderDetailPane } from "../work-order-pane";

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ organization: string; workOrderId: string }>;
}) {
  const { organization, workOrderId } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const pane = await WorkOrderDetailPane({ context, workOrderId });
  if (pane === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Work order" breadcrumbs={[{ label: "Work orders" }]} />
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="Work order not found"
              description="It may belong to another shop, or the link is stale."
              action={
                <Button variant="outline" asChild>
                  <Link href={`/app/${context.organizationId}/work-orders`}>
                    Back to work orders
                  </Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link
            href={`/app/${context.organizationId}/work-orders/workspace?wo=${workOrderId}&active=${workOrderId}`}
          >
            Open in workspace
          </Link>
        </Button>
      </div>
      {pane}
    </div>
  );
}
