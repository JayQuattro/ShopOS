import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { formatDate } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { resolvePaperSize } from "@/modules/organizations/paper-size";
import { PrintButton } from "@/components/print/print-button";
import { PrintFrame, PrintSection } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

const Line = ({ label }: Readonly<{ label: string }>) => (
  <div className="mb-5 flex items-end">
    <span className="w-40 shrink-0 text-neutral-500">{label}</span>
    <span className="flex-1 border-b border-neutral-400" />
  </div>
);

/**
 * Blank write-in intake form for walk-ins: customer, vehicle, concern, and a
 * work-authorization signature block, on shop letterhead.
 */
export default async function IntakePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ paper?: string }>;
}) {
  const { organization } = await params;
  const { paper: paperOverride } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) notFound();

  const org = await db.organization.findUnique({
    where: { id: context.organizationId },
    select: {
      name: true,
      defaultPaperSize: true,
      locations: { where: { active: true }, orderBy: { code: "asc" }, select: { name: true } },
    },
  });
  if (!org) notFound();

  const paper = resolvePaperSize(org.defaultPaperSize, paperOverride);

  return (
    <>
      <PrintButton paper={paper} />
      <PrintFrame
        organizationName={org.name}
        locationName={org.locations.map((location) => location.name).join(" · ")}
        title="Intake form"
        subtitle={formatDate(new Date(), "UTC", "en-US")}
      >
        <PrintSection heading="Customer">
          <Line label="Name" />
          <Line label="Phone" />
          <Line label="Email" />
          <Line label="Address" />
        </PrintSection>

        <PrintSection heading="Vehicle / asset">
          <Line label="Year / make / model" />
          <Line label="VIN or serial" />
          <Line label="Mileage / hours" />
          <Line label="Tag / plate" />
        </PrintSection>

        <PrintSection heading="Concern">
          <div className="mb-2 h-32 border-b border-neutral-400" />
          <Line label="Noted by" />
        </PrintSection>

        <PrintSection heading="Authorization">
          <p className="mb-6">
            I authorize inspection and diagnosis of the vehicle described above and agree that the
            shop may contact me with findings and an estimate before repair work begins.
          </p>
          <div className="grid grid-cols-2 gap-8">
            <div className="border-t border-neutral-900 pt-1">Customer signature</div>
            <div className="border-t border-neutral-900 pt-1">Date</div>
            <div className="mt-6 border-t border-neutral-900 pt-1">Shop representative</div>
            <div className="mt-6 border-t border-neutral-900 pt-1">Date</div>
          </div>
        </PrintSection>
      </PrintFrame>
    </>
  );
}
