import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { SettingsNav } from "../settings-nav";
import { HoursManager } from "./hours-manager";

export const dynamic = "force-dynamic";

export default async function HoursSettingsPage() {
  const context = await getRequestContext();

  const locations = await db.location.findMany({
    where: {
      organizationId: context.organizationId,
      active: true,
      ...(context.organizationWideLocationAccess
        ? {}
        : { id: { in: [...context.allowedLocationIds] } }),
    },
    orderBy: { code: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsNav orgId={context.organizationId} />
      <PageHeader
        title="Business hours"
        description="Weekly open hours and booking capacity per location. Appointments outside hours or beyond capacity are refused."
        breadcrumbs={[{ label: "Settings" }, { label: "Business hours" }]}
      />
      <HoursManager
        locations={locations.map((location) => ({ id: location.id, name: location.name }))}
        canManage={context.permissions.has("organizations.manage")}
      />
    </div>
  );
}
