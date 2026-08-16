import { PageHeader } from "@/components/shopos/page-header";
import { OrgEmailSettingsForm } from "./email-settings-form";

export default async function OrgEmailSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email settings"
        description="Configure your organization's email delivery provider."
        breadcrumbs={[{ label: "Settings" }, { label: "Email" }]}
      />
      <OrgEmailSettingsForm />
    </div>
  );
}
