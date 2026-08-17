import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { PrintButton } from "@/components/print/print-button";
import { PrintFrame, PrintKV, PrintSection } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

export default async function EstimatePrintPage({
  params,
}: {
  params: Promise<{ organization: string; revisionId: string }>;
}) {
  const { organization, revisionId } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) notFound();

  const revision = await db.estimateRevision.findFirst({
    where: { id: revisionId, organizationId: context.organizationId },
    select: {
      revisionNumber: true,
      documentKind: true,
      changeOrderNumber: true,
      summaryNote: true,
      status: true,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      taxMinor: true,
      totalMinor: true,
      presentedAt: true,
      expiresAt: true,
      organization: { select: { name: true } },
      location: { select: { name: true } },
      workOrder: {
        select: {
          number: true,
          createdAt: true,
          customerConcern: true,
          customer: { select: { displayName: true, primaryPhone: true } },
          asset: { select: { displayName: true, manufacturer: true, model: true } },
        },
      },
      lines: {
        orderBy: { position: "asc" },
        select: { description: true, quantityMilli: true, unitPriceMinor: true, totalMinor: true },
      },
    },
  });
  if (!revision) notFound();

  const currency = revision.currency;
  const money = (minor: bigint | number) => formatMoney(Number(minor), currency, "en-US");
  const title =
    revision.documentKind === "CHANGE_ORDER"
      ? `Change order ${revision.changeOrderNumber ?? ""}`.trim()
      : "Estimate";

  return (
    <>
      <PrintButton />
      <PrintFrame
        organizationName={revision.organization.name}
        locationName={revision.location.name}
        title={title}
        subtitle={`${revision.workOrder.number} · revision ${revision.revisionNumber}`}
      >
        <PrintSection heading="Customer & vehicle">
          <PrintKV
            items={[
              ["Customer", revision.workOrder.customer.displayName],
              ["Phone", revision.workOrder.customer.primaryPhone ?? ""],
              [
                "Vehicle / asset",
                [
                  revision.workOrder.asset?.displayName,
                  [revision.workOrder.asset?.manufacturer, revision.workOrder.asset?.model]
                    .filter(Boolean)
                    .join(" "),
                ]
                  .filter(Boolean)
                  .join(" — "),
              ],
              ["Repair order", revision.workOrder.number],
            ]}
          />
        </PrintSection>

        {revision.summaryNote ? (
          <PrintSection heading="Reason">
            <p>{revision.summaryNote}</p>
          </PrintSection>
        ) : null}
        <PrintSection heading="Customer concern">
          <p>{revision.workOrder.customerConcern}</p>
        </PrintSection>

        <PrintSection heading="Work & pricing">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-400 text-left">
                <th className="py-1 pr-3 font-semibold">Description</th>
                <th className="py-1 pr-3 text-right font-semibold">Qty</th>
                <th className="py-1 pr-3 text-right font-semibold">Unit</th>
                <th className="py-1 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {revision.lines.map((line, index) => (
                <tr key={index} className="border-b border-neutral-200 align-top">
                  <td className="py-1.5 pr-3">{line.description}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {(line.quantityMilli / 1000).toFixed(1)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {money(line.unitPriceMinor)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{money(line.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 ml-auto w-56">
            <div className="flex justify-between">
              <span className="text-neutral-500">Subtotal</span>
              <span className="tabular-nums">{money(revision.subtotalMinor)}</span>
            </div>
            {Number(revision.discountMinor) > 0 ? (
              <div className="flex justify-between">
                <span className="text-neutral-500">Discount</span>
                <span className="tabular-nums">-{money(revision.discountMinor)}</span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span className="text-neutral-500">Tax</span>
              <span className="tabular-nums">{money(revision.taxMinor)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-neutral-900 pt-1 text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{money(revision.totalMinor)}</span>
            </div>
          </div>
        </PrintSection>

        {revision.expiresAt ? (
          <p className="text-sm text-neutral-600">
            This estimate is valid through {formatDate(revision.expiresAt, "UTC", "en-US")}.
          </p>
        ) : null}
        <p className="mt-4 text-xs text-neutral-500">
          Document status: {revision.status.toLowerCase()}. Printed copies are a snapshot; the live
          record lives in the shop system.
        </p>
      </PrintFrame>
    </>
  );
}
