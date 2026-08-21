import { PageHeader } from "@/components/shopos/page-header";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { SettingsNav } from "../settings-nav";
import { DisclaimersManager } from "./disclaimers-manager";

export const dynamic = "force-dynamic";

export default async function DisclaimersSettingsPage() {
  const context = await getRequestContext();
  return (
    <div className="flex flex-col gap-6">
      <SettingsNav orgId={context.organizationId} />
      <PageHeader
        title="Disclaimers"
        description="Canned disclaimers for invoices. Triggered ones are suggested when they apply — never forced."
        breadcrumbs={[{ label: "Settings" }, { label: "Disclaimers" }]}
      />
      <DisclaimersManager canManage={context.permissions.has("work_orders.write")} />
    </div>
  );
}
