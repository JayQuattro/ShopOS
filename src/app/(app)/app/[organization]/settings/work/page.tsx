import { PageHeader } from "@/components/shopos/page-header";
import { WorkPreferencesForm } from "./work-preferences-form";

export default async function WorkPreferencesSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Work preferences"
        description="Choose how change orders and invoices handle approvals and pricing."
        breadcrumbs={[{ label: "Settings" }, { label: "Work" }]}
      />
      <WorkPreferencesForm />
    </div>
  );
}
