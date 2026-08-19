import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listBoardStages } from "@/modules/work-orders/board-stage-service";
import { StagesManager } from "./stages-manager";

export const dynamic = "force-dynamic";

/**
 * The shop's own workflow columns: shops think in their own stages —
 * "Detail", "Waiting on customer", "Sublet out" — and the work board
 * groups by them. Until stages are configured the board keeps its
 * built-in columns.
 */
export default async function StagesSettingsPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const stages = await listBoardStages({ db, context });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Board stages"
        description="Your own workflow columns on the work board. Empty = the built-in stages."
        breadcrumbs={[{ label: "Settings" }, { label: "Board stages" }]}
      />
      <StagesManager organizationId={organization} initialStages={stages} />
    </div>
  );
}
