import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { resolvePaperSize } from "@/modules/organizations/paper-size";
import { orgContactLine } from "@/modules/organizations/org-contact";
import { PrintButton } from "@/components/print/print-button";
import { PrintFrame, PrintKV, PrintSection } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string; invoiceId: string }>;
  searchParams: Promise<{ paper?: string }>;
}) {
  const { organization, invoiceId } = await params;
  const { paper: paperOverride } = await searchParams;
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
      taxInclusive: true,
      totalMinor: true,
      paidMinor: true,
      issuedAt: true,
      warrantyMonths: true,
      warrantyMiles: true,
      disclaimers: {
        orderBy: { position: "asc" as const },
        select: { id: true, name: true, body: true },
      },
      organization: {
        select: {
          name: true,
          defaultPaperSize: true,
          defaultLocale: true,
          taxId: true,
          contactPhone: true,
          contactEmail: true,
          addressLine1: true,
          city: true,
          stateProvince: true,
          postalCode: true,
        },
      },
      location: { select: { name: true } },
      workOrder: {
        select: {
          number: true,
          completedAt: true,
          customer: { select: { displayName: true, primaryPhone: true, taxId: true } },
          asset: { select: { displayName: true } },
        },
      },
      lines: {
        orderBy: { position: "asc" },
        select: {
          description: true,
          quantityMilli: true,
          unitPriceMinor: true,
          totalMinor: true,
          taxComponents: true,
        },
      },
      payments: {
        orderBy: { receivedAt: "asc" },
        select: { amountMinor: true, method: true, receivedAt: true, reference: true },
      },
    },
  });
  if (!invoice) notFound();

  const currency = invoice.currency;
  const money = (minor: bigint | number) => formatMoney(Number(minor), currency, locale);
  const balance = invoice.totalMinor - invoice.paidMinor;

  const locale = invoice.organization.defaultLocale ?? "en-US";
  const paper = resolvePaperSize(invoice.organization.defaultPaperSize, paperOverride);

  return (
    <>
      <PrintButton paper={paper} />
      <PrintFrame
        contactLine={orgContactLine(invoice.organization)}
        organizationName={invoice.organization.name}
        locationName={invoice.location.name}
        title="Invoice"
        subtitle={`${invoice.number} · ${invoice.workOrder.number}`}
        paper={paper}
      >
        <PrintSection heading="Bill to">
          <PrintKV
            items={[
              ["Customer", invoice.workOrder.customer.displayName],
              ["Phone", invoice.workOrder.customer.primaryPhone ?? ""],
              ...(invoice.workOrder.customer.taxId
                ? [["Customer tax ID", invoice.workOrder.customer.taxId] as const]
                : []),
              ["Vehicle / asset", invoice.workOrder.asset?.displayName ?? ""],
              [
                "Invoice date",
                invoice.issuedAt ? formatDate(invoice.issuedAt, "UTC", locale) : "draft",
              ],
            ]}
          />
          {invoice.organization.taxId ? (
            <p className="mt-2 text-xs text-neutral-500">
              Seller tax registration: {invoice.organization.taxId}
            </p>
          ) : null}
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
              <span className="text-neutral-500">
                Tax{invoice.taxInclusive ? " (included in total)" : ""}
              </span>
              <span className="tabular-nums">{money(invoice.taxMinor)}</span>
              {(() => {
                const components = invoice.lines
                  .flatMap((line) =>
                    Array.isArray(line.taxComponents)
                      ? (line.taxComponents as Array<{ name: string; amountMinor: number }>)
                      : [],
                  )
                  .reduce<Array<[string, number]>>((acc, component) => {
                    const existing = acc.find(([name]) => name === component.name);
                    if (existing) existing[1] += component.amountMinor;
                    else acc.push([component.name, component.amountMinor]);
                    return acc;
                  }, []);
                if (components.length < 2) return null;
                return (
                  <p className="col-span-2 text-right text-xs text-neutral-500">
                    {components.map(([name, amount]) => `${name}: ${money(amount)}`).join(" · ")}
                  </p>
                );
              })()}
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

        {invoice.warrantyMonths || invoice.warrantyMiles ? (
          <p className="text-sm text-neutral-700">
            <span className="font-semibold">Warranty: </span>
            {[
              invoice.warrantyMonths ? `${invoice.warrantyMonths} months` : null,
              invoice.warrantyMiles
                ? `${Intl.NumberFormat(locale).format(invoice.warrantyMiles)} miles`
                : null,
            ]
              .filter(Boolean)
              .join(" or ")}{" "}
            from invoice date, covering defects in workmanship.
          </p>
        ) : null}

        {invoice.disclaimers.length > 0 ? (
          <PrintSection heading="Disclaimers">
            <ul className="flex flex-col gap-2">
              {invoice.disclaimers.map((disclaimer) => (
                <li key={disclaimer.id}>
                  <p className="font-semibold">{disclaimer.name}</p>
                  <p className="whitespace-pre-line text-neutral-700">{disclaimer.body}</p>
                </li>
              ))}
            </ul>
          </PrintSection>
        ) : null}

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
                    <td className="py-1.5 pr-3">{formatDate(payment.receivedAt, "UTC", locale)}</td>
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
