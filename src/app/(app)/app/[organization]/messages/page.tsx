import { PageHeader } from "@/components/shopos/page-header";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { SmsInbox } from "./sms-inbox";

export const dynamic = "force-dynamic";

export default async function MessagesPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messages"
        description="Two-way texting with customers."
        breadcrumbs={[{ label: "Messages" }]}
      />
      <SmsInbox orgPath={`/api/organizations/${context.organizationId}`} />
    </div>
  );
}
