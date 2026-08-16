import { PageHeader } from "@/components/shopos/page-header";
import { StorageSettingsForm } from "./storage-settings-form";

export default async function PlatformStorageSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Storage settings"
        description="Configure the platform-wide file storage provider."
        breadcrumbs={[{ label: "Platform", href: "/platform" }, { label: "Storage settings" }]}
      />
      <StorageSettingsForm />
    </div>
  );
}
