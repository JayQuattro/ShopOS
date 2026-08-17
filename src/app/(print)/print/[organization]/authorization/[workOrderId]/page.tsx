import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { resolvePaperSize } from "@/modules/organizations/paper-size";
import { PrintButton } from "@/components/print/print-button";
import { PrintFrame, PrintKV, PrintSection } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

/**
 * Work authorization document: the presented work, its cost, and signature
 * blocks for the customer to authorize labor, parts, and the total amount.
 * Signed on paper; the signed copy is the customer's record.
 */
export default async function AuthorizationPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string; workOrderId: string }>;
  searchParams: Promise<{ paper?: string }>;
}) {
  const { organization, workOrderId } = await params;
  const { paper: paperOverride } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) notFound();

  const workOrder = await db.workOrder.findFirst({
    where: { id: workOrderId, organizationId: context.organizationId },
    select: {
      number: true,
      createdAt: true,
      customerConcern: true,
      organization: { select: { name: true, defaultPaperSize: true } },
      location: { select: { name: true } },
      customer: { select: { displayName: true, primaryPhone: true } },
      asset: { select: { displayName: true, manufacturer: true, model: true } },
      estimateRevisions: {
        where: { status: "PRESENTED" },
        orderBy: { revisionNumber: "asc" },
        select: {
          revisionNumber: true,
          documentKind: true,
          changeOrderNumber: true,
          currency: true,
          totalMinor: true,
          presentedAt: true,
          lines: {
            orderBy: { position: "asc" },
            select: {
              description: true,
              totalMinor: true,
              authorizationDecisions: { select: { decision: true }, take: 1 },
            },
          },
        },
      },
    },
  });
  if (!workOrder) notFound();

  const baseline = workOrder.estimateRevisions.find(
    (revision) => revision.documentKind === "BASELINE",
  );
  if (!baseline) notFound();

  const currency = baseline.currency;
  const money = (minor: bigint | number) => formatMoney(Number(minor), currency, "en-US");
  const cumulative = workOrder.estimateRevisions.reduce(
    (sum, revision) => sum + revision.totalMinor,
    0n,
  );

  const paper = resolvePaperSize(workOrder.organization.defaultPaperSize, paperOverride);

  return (
    <>
      <PrintButton paper={paper} />
      <PrintFrame
        organizationName={workOrder.organization.name}
        locationName={workOrder.location.name}
        title="Work authorization"
        subtitle={workOrder.number}
        paper={paper}
      >
        <PrintSection heading="Customer & vehicle">
          <PrintKV
            items={[
              ["Customer", workOrder.customer.displayName],
              ["Phone", workOrder.customer.primaryPhone ?? ""],
              ["Vehicle / asset", workOrder.asset?.displayName ?? ""],
              [
                "Make / model",
                [workOrder.asset?.manufacturer, workOrder.asset?.model].filter(Boolean).join(" "),
              ],
              ["Date", formatDate(workOrder.createdAt, "UTC", "en-US")],
              ["Repair order", workOrder.number],
            ]}
          />
        </PrintSection>

        <PrintSection heading="Requested service">
          <p>{workOrder.customerConcern}</p>
        </PrintSection>

        {workOrder.estimateRevisions.map((revision) => (
          <PrintSection
            key={revision.revisionNumber}
            heading={
              revision.documentKind === "CHANGE_ORDER"
                ? `Change order ${revision.changeOrderNumber ?? ""}`.trim()
                : `Estimate (revision ${revision.revisionNumber})`
            }
          >
            <table className="w-full border-collapse">
              <tbody>
                {revision.lines.map((line, index) => (
                  <tr key={index} className="border-b border-neutral-200">
                    <td className="py-1.5 pr-3">{line.description}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(line.totalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1 flex justify-between border-t border-neutral-400 pt-1 font-bold">
              <span>Document total</span>
              <span className="tabular-nums">{money(revision.totalMinor)}</span>
            </div>
          </PrintSection>
        ))}

        <div className="mb-5 border-2 border-neutral-900 p-3">
          <div className="flex justify-between text-base font-bold">
            <span>Total authorized amount</span>
            <span className="tabular-nums">{money(cumulative)}</span>
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            Includes labor, parts, and applicable taxes for all documents above.
          </p>
        </div>

        <PrintSection heading="Authorization">
          <p className="mb-6">
            I authorize the work listed above, including necessary labor, parts, and materials, up
            to the total authorized amount. I understand that changes beyond this amount will be
            presented for additional authorization before work continues.
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
