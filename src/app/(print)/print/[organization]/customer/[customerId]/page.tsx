import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { resolvePaperSize } from "@/modules/organizations/paper-size";
import { PrintButton } from "@/components/print/print-button";
import { PrintFrame, PrintKV, PrintSection } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

export default async function CustomerPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string; customerId: string }>;
  searchParams: Promise<{ paper?: string }>;
}) {
  const { organization, customerId } = await params;
  const { paper: paperOverride } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) notFound();

  const customer = await db.customer.findFirst({
    where: { id: customerId, organizationId: context.organizationId },
    select: {
      displayName: true,
      kind: true,
      primaryEmail: true,
      primaryPhone: true,
      organizationReference: true,
      internalNotes: true,
      organization: { select: { name: true, defaultPaperSize: true } },
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
        select: { name: true, role: true, email: true, phone: true },
      },
      addresses: {
        orderBy: [{ isPrimary: "desc" }],
        select: {
          label: true,
          line1: true,
          line2: true,
          city: true,
          stateProvince: true,
          postalCode: true,
          country: true,
        },
      },
      assets: {
        where: { status: { not: "SOLD" } },
        orderBy: { displayName: "asc" },
        select: { displayName: true, category: true, manufacturer: true, model: true },
      },
      workOrders: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          number: true,
          status: true,
          createdAt: true,
          asset: { select: { displayName: true } },
          invoice: { select: { currency: true, totalMinor: true } },
        },
      },
    },
  });
  if (!customer) notFound();

  const lifetime = new Map<string, number>();
  for (const wo of customer.workOrders) {
    if (!wo.invoice) continue;
    lifetime.set(
      wo.invoice.currency,
      (lifetime.get(wo.invoice.currency) ?? 0) + Number(wo.invoice.totalMinor),
    );
  }

  const paper = resolvePaperSize(customer.organization.defaultPaperSize, paperOverride);

  return (
    <>
      <PrintButton paper={paper} />
      <PrintFrame
        organizationName={customer.organization.name}
        locationName={null}
        title="Customer record"
        subtitle={customer.displayName}
        paper={paper}
      >
        <PrintSection heading="Profile">
          <PrintKV
            items={[
              ["Name", customer.displayName],
              ["Type", customer.kind.toLowerCase()],
              ["Email", customer.primaryEmail ?? ""],
              ["Phone", customer.primaryPhone ?? ""],
              ["Reference", customer.organizationReference ?? ""],
            ]}
          />
          {customer.internalNotes ? (
            <p className="mt-3 whitespace-pre-line text-neutral-700">{customer.internalNotes}</p>
          ) : null}
        </PrintSection>

        {customer.contacts.length > 0 ? (
          <PrintSection heading="Contacts">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-400 text-left">
                  <th className="py-1 pr-3 font-semibold">Name</th>
                  <th className="py-1 pr-3 font-semibold">Role</th>
                  <th className="py-1 pr-3 font-semibold">Email</th>
                  <th className="py-1 font-semibold">Phone</th>
                </tr>
              </thead>
              <tbody>
                {customer.contacts.map((contact, index) => (
                  <tr key={index} className="border-b border-neutral-200">
                    <td className="py-1.5 pr-3">{contact.name}</td>
                    <td className="py-1.5 pr-3">{contact.role ?? ""}</td>
                    <td className="py-1.5 pr-3">{contact.email ?? ""}</td>
                    <td className="py-1.5">{contact.phone ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PrintSection>
        ) : null}

        {customer.addresses.length > 0 ? (
          <PrintSection heading="Addresses">
            <ul className="flex flex-col gap-1">
              {customer.addresses.map((address, index) => (
                <li key={index}>
                  <span className="font-medium">{address.label}:</span>{" "}
                  {[
                    address.line1,
                    address.line2,
                    [address.city, address.stateProvince, address.postalCode]
                      .filter(Boolean)
                      .join(", "),
                    address.country,
                  ]
                    .filter(Boolean)
                    .join(" — ")}
                </li>
              ))}
            </ul>
          </PrintSection>
        ) : null}

        {customer.assets.length > 0 ? (
          <PrintSection heading="Assets">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-400 text-left">
                  <th className="py-1 pr-3 font-semibold">Asset</th>
                  <th className="py-1 pr-3 font-semibold">Category</th>
                  <th className="py-1 font-semibold">Make / model</th>
                </tr>
              </thead>
              <tbody>
                {customer.assets.map((asset, index) => (
                  <tr key={index} className="border-b border-neutral-200">
                    <td className="py-1.5 pr-3">{asset.displayName}</td>
                    <td className="py-1.5 pr-3">{asset.category}</td>
                    <td className="py-1.5">
                      {[asset.manufacturer, asset.model].filter(Boolean).join(" ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PrintSection>
        ) : null}

        <PrintSection heading="Service history">
          {customer.workOrders.length === 0 ? (
            <p>No visits yet.</p>
          ) : (
            <>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-neutral-400 text-left">
                    <th className="py-1 pr-3 font-semibold">Date</th>
                    <th className="py-1 pr-3 font-semibold">RO #</th>
                    <th className="py-1 pr-3 font-semibold">Vehicle</th>
                    <th className="py-1 pr-3 font-semibold">Status</th>
                    <th className="py-1 text-right font-semibold">Invoiced</th>
                  </tr>
                </thead>
                <tbody>
                  {customer.workOrders.map((wo, index) => (
                    <tr key={index} className="border-b border-neutral-200">
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {formatDate(wo.createdAt, "UTC", "en-US")}
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{wo.number}</td>
                      <td className="py-1.5 pr-3">{wo.asset?.displayName ?? "—"}</td>
                      <td className="py-1.5 pr-3">{wo.status.replace(/_/g, " ").toLowerCase()}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {wo.invoice
                          ? formatMoney(Number(wo.invoice.totalMinor), wo.invoice.currency, "en-US")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lifetime.size > 0 ? (
                <p className="mt-2 text-sm">
                  <span className="font-semibold">
                    Lifetime invoiced (last {customer.workOrders.length} visits):
                  </span>{" "}
                  {[...lifetime.entries()]
                    .map(([currency_, minor]) => formatMoney(minor, currency_, "en-US"))
                    .join(" · ")}
                </p>
              ) : null}
            </>
          )}
        </PrintSection>
      </PrintFrame>
    </>
  );
}
