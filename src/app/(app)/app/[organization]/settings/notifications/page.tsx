import { PageHeader } from "@/components/shopos/page-header";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { SettingsNav } from "../settings-nav";
import { NotificationsForm } from "./notifications-form";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const context = await getRequestContext();
  return (
    <div className="flex flex-col gap-6">
      <SettingsNav orgId={context.organizationId} />
      <PageHeader
        title="Notifications"
        description="Choose which messages customers receive, and when."
        breadcrumbs={[{ label: "Settings" }, { label: "Notifications" }]}
      />
      <NotificationsForm />
    </div>
  );
}
