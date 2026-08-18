import { PageHeader } from "@/components/shopos/page-header";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { SettingsNav } from "../settings-nav";
import { WorkPreferencesForm } from "./work-preferences-form";

export default async function WorkPreferencesSettingsPage() {
  const context = await getRequestContext();
  return (
    <div className="flex flex-col gap-6">
      <SettingsNav orgId={context.organizationId} />
      <PageHeader
        title="Work preferences"
        description="Choose how change orders and invoices handle approvals and pricing."
        breadcrumbs={[{ label: "Settings" }, { label: "Work" }]}
      />
      <WorkPreferencesForm />
    </div>
  );
}
