import { PageHeader } from "@/components/shopos/page-header";
import { VehicleIdSettingsForm } from "./vehicle-id-settings-form";

export default async function PlatformVehicleIdSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vehicle identification"
        description="VIN decoding provider for vehicle entry and profile enrichment."
        breadcrumbs={[{ label: "Platform" }, { label: "Settings" }, { label: "Vehicle ID" }]}
      />
      <VehicleIdSettingsForm />
    </div>
  );
}
