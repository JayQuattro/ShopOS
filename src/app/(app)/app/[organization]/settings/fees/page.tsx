import { PageHeader } from "@/components/shopos/page-header";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { SettingsNav } from "../settings-nav";
import { FeesManager } from "./fees-manager";

export const dynamic = "force-dynamic";

export default async function FeesSettingsPage() {
  const context = await getRequestContext();
  return (
    <div className="flex flex-col gap-6">
      <SettingsNav orgId={context.organizationId} />
      <PageHeader
        title="Fees"
        description="Recurring charges added automatically to presented estimates — shop supplies, hazmat, disposal."
        breadcrumbs={[{ label: "Settings" }, { label: "Fees" }]}
      />
      <FeesManager canManage={context.permissions.has("organizations.manage")} />
    </div>
  );
}
