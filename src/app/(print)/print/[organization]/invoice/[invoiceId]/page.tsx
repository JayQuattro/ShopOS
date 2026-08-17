import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { PrintButton } from "@/components/print/print-button";
import { PrintFrame, PrintKV, PrintSection } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ organization: string; invoiceId: string }>;
}) {
  const { organization, invoiceId } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) notFound();

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId: context.organizationId },
    select: {
      number: true,
      status: true,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      taxMinor: true,
      totalMinor: true,
      paidMinor: true,
      issuedAt: true,
      organization: { select: { name: true } },
      location: { select: { name: true } },
      workOrder: {
        select: {
          number: true,
          completedAt: true,
          customer: { select: { displayName: true, primaryPhone: true } },
          asset: { select: { displayName: true } },
        },
      },
      lines: {
        orderBy: { position: "asc" },
        select: { description: true, quantityMilli: true, unitPriceMinor: true, totalMinor: true },
      },
      payments: {
        orderBy: { receivedAt: "asc" },
        select: { amountMinor: true, method: true, receivedAt: true, reference: true },
      },
    },
  });
  if (!invoice) notFound();

  const currency = invoice.currency;
  const money = (minor: bigint | number) => formatMoney(Number(minor), currency, "en-US");
  const balance = invoice.totalMinor - invoice.paidMinor;

  return (
    <>
      <PrintButton />
      <PrintFrame
        organizationName={invoice.organization.name}
        locationName={invoice.location.name}
        title="Invoice"
        subtitle={`${invoice.number} · ${invoice.workOrder.number}`}
      >
        <PrintSection heading="Bill to">
          <PrintKV
            items={[
              ["Customer", invoice.workOrder.customer.displayName],
              ["Phone", invoice.workOrder.customer.primaryPhone ?? ""],
              ["Vehicle / asset", invoice.workOrder.asset?.displayName ?? ""],
              [
                "Invoice date",
                invoice.issuedAt ? formatDate(invoice.issuedAt, "UTC", "en-US") : "draft",
              ],
            ]}
          />
        </PrintSection>

        <PrintSection heading="Charges">
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
              {invoice.lines.map((line, index) => (
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
              <span className="tabular-nums">{money(invoice.subtotalMinor)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Tax</span>
              <span className="tabular-nums">{money(invoice.taxMinor)}</span>
            </div>
            <div className="flex justify-between border-t border-neutral-900 pt-1 font-bold">
              <span>Total</span>
              <span className="tabular-nums">{money(invoice.totalMinor)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Paid</span>
              <span className="tabular-nums">{money(invoice.paidMinor)}</span>
            </div>
            <div className="flex justify-between border-t border-neutral-400 pt-1 font-bold">
              <span>{Number(balance) > 0 ? "Balance due" : "Status"}</span>
              <span className="tabular-nums">
                {Number(balance) > 0 ? money(balance) : invoice.status.toLowerCase()}
              </span>
            </div>
          </div>
        </PrintSection>

        {invoice.payments.length > 0 ? (
          <PrintSection heading="Payments">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-400 text-left">
                  <th className="py-1 pr-3 font-semibold">Date</th>
                  <th className="py-1 pr-3 font-semibold">Method</th>
                  <th className="py-1 pr-3 font-semibold">Reference</th>
                  <th className="py-1 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((payment, index) => (
                  <tr key={index} className="border-b border-neutral-200">
                    <td className="py-1.5 pr-3">
                      {formatDate(payment.receivedAt, "UTC", "en-US")}
                    </td>
                    <td className="py-1.5 pr-3">
                      {payment.method.replace(/_/g, " ").toLowerCase()}
                    </td>
                    <td className="py-1.5 pr-3">{payment.reference ?? ""}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(payment.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PrintSection>
        ) : null}

        <p className="mt-6 text-sm text-neutral-600">Thank you for your business.</p>
      </PrintFrame>
    </>
  );
}
