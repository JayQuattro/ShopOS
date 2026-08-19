import { PageHeader } from "@/components/shopos/page-header";
import { PaymentsSettingsForm } from "./payments-settings-form";

export const dynamic = "force-dynamic";

export default async function PaymentsSettingsPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Connect your own payment processor — customers pay you directly."
        breadcrumbs={[{ label: "Settings" }, { label: "Payments" }]}
      />
      <PaymentsSettingsForm organizationId={organization} />
    </div>
  );
}
