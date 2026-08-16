import { PageHeader } from "@/components/shopos/page-header";
import { EmailSettingsForm } from "./email-settings-form";

export default async function PlatformEmailSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email settings"
        description="Configure the platform-wide email delivery provider."
        breadcrumbs={[{ label: "Platform", href: "/platform" }, { label: "Email settings" }]}
      />
      <EmailSettingsForm />
    </div>
  );
}
