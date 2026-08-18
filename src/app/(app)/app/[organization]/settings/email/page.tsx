import { PageHeader } from "@/components/shopos/page-header";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { SettingsNav } from "../settings-nav";
import { OrgEmailSettingsForm } from "./email-settings-form";

export default async function OrgEmailSettingsPage() {
  const context = await getRequestContext();
  return (
    <div className="flex flex-col gap-6">
      <SettingsNav orgId={context.organizationId} />
      <PageHeader
        title="Email settings"
        description="Configure your organization's email delivery provider."
        breadcrumbs={[{ label: "Settings" }, { label: "Email" }]}
      />
      <OrgEmailSettingsForm />
    </div>
  );
}
