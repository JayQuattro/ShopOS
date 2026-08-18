import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDateTime, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listDeclinedWork } from "@/modules/followups/declined-work-service";

export const dynamic = "force-dynamic";

/**
 * Declined-work follow-up board: estimate lines the customer explicitly
 * declined on jobs that aren't closed yet — the re-quote list. Oldest first,
 * so the ripest conversations are on top.
 */
export default async function DeclinedWorkPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const items = await listDeclinedWork({ db, context });
  const totalByCurrency = new Map<string, number>();
  for (const item of items) {
    totalByCurrency.set(
      item.currency,
      (totalByCurrency.get(item.currency) ?? 0) + Number(item.amountMinor),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Declined work"
        description="Work the customer declined that isn't closed out — call, re-quote, win it back."
        breadcrumbs={[{ label: "Declined work" }]}
      />

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No declined work to follow up on.
            </p>
          ) : (
            <>
              <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
                {items.length} item{items.length === 1 ? "" : "s"}
                {totalByCurrency.size > 0
                  ? ` · opportunity: ${[...totalByCurrency.entries()]
                      .map(([currency, minor]) => formatMoney(minor, currency, "en-US"))
                      .join(" · ")}`
                  : ""}
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Declined</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Vehicle / asset</th>
                    <th className="px-4 py-3 font-medium">Work</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Job</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.decisionId}
                      className="border-b border-border/60 hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                        {formatDateTime(item.declinedAt, "UTC", "en-US")}
                      </td>
                      <td className="px-4 py-3">{item.customerName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.assetName ?? "—"}</td>
                      <td className="px-4 py-3 max-w-xs">{item.description}</td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        {formatMoney(Number(item.amountMinor), item.currency, "en-US")}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/${context.organizationId}/work-orders/${item.workOrderId}`}
                          className="font-mono text-link underline-offset-4 hover:underline"
                        >
                          {item.workOrderNumber}
                        </Link>
                        <Badge variant="outline" className="ml-2 text-xs">
                          {item.workOrderStatus.replace(/_/g, " ").toLowerCase()}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/${context.organizationId}/customers/${item.customerId}`}
                          className="text-link underline-offset-4 hover:underline"
                        >
                          Profile
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
