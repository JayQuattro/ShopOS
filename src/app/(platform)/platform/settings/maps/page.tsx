import { PageHeader } from "@/components/shopos/page-header";
import { MapsSettingsForm } from "./maps-settings-form";

export default async function PlatformMapsSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Maps"
        description="Geocoding and routing provider for service-call locations and ETAs."
        breadcrumbs={[{ label: "Platform" }, { label: "Settings" }, { label: "Maps" }]}
      />
      <MapsSettingsForm />
    </div>
  );
}
