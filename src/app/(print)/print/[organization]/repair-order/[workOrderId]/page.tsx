import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { PrintButton } from "@/components/print/print-button";
import { PrintFrame, PrintKV, PrintSection } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

export default async function RepairOrderPrintPage({
  params,
}: {
  params: Promise<{ organization: string; workOrderId: string }>;
}) {
  const { organization, workOrderId } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) notFound();

  const workOrder = await db.workOrder.findFirst({
    where: { id: workOrderId, organizationId: context.organizationId },
    select: {
      number: true,
      status: true,
      workType: true,
      customerConcern: true,
      createdAt: true,
      promisedAt: true,
      completedAt: true,
      bayLabel: true,
      organization: { select: { name: true } },
      location: { select: { name: true, timeZone: true } },
      customer: { select: { displayName: true, primaryPhone: true, primaryEmail: true } },
      asset: { select: { displayName: true, manufacturer: true, model: true } },
      assignedTechnician: { select: { displayName: true } },
      assistingTechnicians: { select: { user: { select: { displayName: true } } } },
      tasks: {
        orderBy: { position: "asc" },
        select: { title: true, status: true, outcomeNote: true },
      },
      partOrders: {
        select: {
          status: true,
          trackingNumber: true,
          supplier: { select: { name: true } },
          lines: { select: { description: true, quantity: true, receivedQuantity: true } },
        },
      },
      timeEntries: { select: { startedAt: true, endedAt: true } },
      estimateRevisions: {
        where: { status: "PRESENTED" },
        orderBy: { revisionNumber: "desc" },
        take: 1,
        select: { currency: true, totalMinor: true },
      },
      invoice: {
        select: { number: true, status: true, currency: true, totalMinor: true, paidMinor: true },
      },
    },
  });
  if (!workOrder) notFound();

  const tz = workOrder.location.timeZone;
  const totalMinutes = workOrder.timeEntries.reduce((sum, entry) => {
    if (!entry.endedAt) return sum;
    return (
      sum + Math.max(0, Math.round((entry.endedAt.getTime() - entry.startedAt.getTime()) / 60_000))
    );
  }, 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutesLeft = totalMinutes % 60;
  const latestEstimate = workOrder.estimateRevisions[0];

  return (
    <>
      <PrintButton />
      <PrintFrame
        organizationName={workOrder.organization.name}
        locationName={workOrder.location.name}
        title="Repair order"
        subtitle={workOrder.number}
      >
        <PrintSection heading="Customer & vehicle">
          <PrintKV
            items={[
              ["Customer", workOrder.customer.displayName],
              ["Phone", workOrder.customer.primaryPhone ?? ""],
              ["Email", workOrder.customer.primaryEmail ?? ""],
              ["Vehicle / asset", workOrder.asset?.displayName ?? ""],
              [
                "Make / model",
                [workOrder.asset?.manufacturer, workOrder.asset?.model].filter(Boolean).join(" "),
              ],
              ["Opened", formatDate(workOrder.createdAt, tz, "en-US")],
              [
                "Promised",
                workOrder.promisedAt ? formatDateTime(workOrder.promisedAt, tz, "en-US") : "",
              ],
              ["Status", workOrder.status.replace(/_/g, " ").toLowerCase()],
              ["Bay", workOrder.bayLabel ?? ""],
            ]}
          />
        </PrintSection>

        <PrintSection heading="Customer concern">
          <p>{workOrder.customerConcern}</p>
        </PrintSection>

        <PrintSection heading="Technicians">
          <p>
            {workOrder.assignedTechnician?.displayName ?? "Unassigned"}
            {workOrder.assistingTechnicians.length > 0
              ? `, also working: ${workOrder.assistingTechnicians.map((entry) => entry.user.displayName).join(", ")}`
              : ""}
          </p>
          <p className="mt-1 text-neutral-600">
            Time on job: {hours}h {minutesLeft}m
          </p>
        </PrintSection>

        {workOrder.tasks.length > 0 ? (
          <PrintSection heading="Checklist / inspection">
            <table className="w-full border-collapse">
              <tbody>
                {workOrder.tasks.map((task, index) => (
                  <tr key={index} className="border-b border-neutral-200">
                    <td className="py-1.5 pr-3 font-mono">☐</td>
                    <td className="py-1.5 pr-3">{task.title}</td>
                    <td className="py-1.5 pr-3 text-neutral-500">{task.outcomeNote ?? ""}</td>
                    <td className="py-1.5 text-right text-neutral-500">
                      {task.status === "DONE"
                        ? "passed"
                        : task.status === "NEEDS_ATTENTION"
                          ? "flagged"
                          : task.status === "SKIPPED"
                            ? "skipped"
                            : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PrintSection>
        ) : null}

        {workOrder.partOrders.length > 0 ? (
          <PrintSection heading="Parts">
            <ul className="flex flex-col gap-1">
              {workOrder.partOrders.map((order, index) => (
                <li key={index}>
                  <span className="font-medium">{order.supplier.name}</span>{" "}
                  <span className="text-neutral-500">
                    ({order.status.toLowerCase()}
                    {order.trackingNumber ? `, tracking ${order.trackingNumber}` : ""})
                  </span>
                  <ul className="ml-4 list-disc">
                    {order.lines.map((line, lineIndex) => (
                      <li key={lineIndex}>
                        {line.description} — {line.receivedQuantity}/{line.quantity} received
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </PrintSection>
        ) : null}

        {latestEstimate ? (
          <PrintSection heading="Authorized work">
            <p>
              Estimate total:{" "}
              <strong>
                {formatMoney(Number(latestEstimate.totalMinor), latestEstimate.currency, "en-US")}
              </strong>
            </p>
            {workOrder.invoice ? (
              <p className="mt-1">
                Invoice {workOrder.invoice.number} ({workOrder.invoice.status.toLowerCase()}):{" "}
                {formatMoney(
                  Number(workOrder.invoice.totalMinor),
                  workOrder.invoice.currency,
                  "en-US",
                )}{" "}
                — paid{" "}
                {formatMoney(
                  Number(workOrder.invoice.paidMinor),
                  workOrder.invoice.currency,
                  "en-US",
                )}
              </p>
            ) : null}
          </PrintSection>
        ) : null}
      </PrintFrame>
    </>
  );
}
