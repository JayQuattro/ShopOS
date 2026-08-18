import { PageHeader } from "@/components/shopos/page-header";
import { SettingsNav } from "../settings-nav";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { getShopProfile } from "@/modules/organizations/org-profile-service";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ShopProfileSettingsPage() {
  const context = await getRequestContext();
  const profile = await getShopProfile(db, context);

  return (
    <div className="flex flex-col gap-6">
      <SettingsNav orgId={context.organizationId} />
      <PageHeader
        title="Shop profile"
        description="Your shop's identity and contact details — used on customer-facing pages, documents, and messages."
        breadcrumbs={[{ label: "Settings" }, { label: "Shop profile" }]}
      />
      <ProfileForm initial={profile} />
    </div>
  );
}
