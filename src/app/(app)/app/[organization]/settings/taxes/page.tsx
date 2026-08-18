import { PageHeader } from "@/components/shopos/page-header";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { SettingsNav } from "../settings-nav";
import { TaxesManager } from "./taxes-manager";

export const dynamic = "force-dynamic";

export default async function TaxesSettingsPage() {
  const context = await getRequestContext();
  return (
    <div className="flex flex-col gap-6">
      <SettingsNav orgId={context.organizationId} />
      <PageHeader
        title="Taxes"
        description="Named tax rates for quick pick on estimate and template lines."
        breadcrumbs={[{ label: "Settings" }, { label: "Taxes" }]}
      />
      <TaxesManager canManage={context.permissions.has("organizations.manage")} />
    </div>
  );
}
