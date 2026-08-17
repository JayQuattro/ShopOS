import { PageHeader } from "@/components/shopos/page-header";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { ServiceMenuManager } from "./service-menu-manager";

export default async function ServiceMenuPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const context = await getRequestContext();
  const { organization } = await params;
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Service menu"
        description="Save the jobs and inspections you do most often, then apply them to a work order in one tap."
        breadcrumbs={[{ label: "Service menu" }]}
      />
      <ServiceMenuManager canWrite={context.permissions.has("work_orders.write")} />
    </div>
  );
}
