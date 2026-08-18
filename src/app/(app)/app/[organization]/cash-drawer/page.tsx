import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDateTime, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { getOpenCashDrawer, listClosedCashDrawers } from "@/modules/billing/cash-drawer-service";
import { DrawerControls } from "./drawer-controls";

export const dynamic = "force-dynamic";

const METHOD_LABELS: Readonly<Record<string, string>> = {
  CASH: "Cash",
  CARD_EXTERNAL: "Card",
  CHECK: "Check",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

/**
 * The nightly close-out: one open drawer per location, running totals by
 * payment method since it opened, count-the-cash at close, and over/short
 * history for reconciliation.
 */
export default async function CashDrawerPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const canRecord = context.permissions.has("payments.record");
  if (!canRecord) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Cash drawer" breadcrumbs={[{ label: "Cash drawer" }]} />
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              The cash drawer needs payment-record access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const locations = await db.location.findMany({
    where: {
      organizationId: context.organizationId,
      active: true,
      ...(context.organizationWideLocationAccess
        ? {}
        : { id: { in: [...context.allowedLocationIds] } }),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const openDrawers = await Promise.all(
    locations.map(async (location) => ({
      locationId: location.id,
      locationName: location.name,
      drawer: await getOpenCashDrawer({ db, context, locationId: location.id }),
    })),
  );
  const closed = await listClosedCashDrawers({ db, context });
  const org = await db.organization.findUnique({
    where: { id: context.organizationId },
    select: { defaultCurrency: true },
  });
  const currency = org?.defaultCurrency ?? "USD";

  const openCount = openDrawers.filter((entry) => entry.drawer).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cash drawer"
        description="Open the drawer at shift start, count the cash at close, keep over/short honest."
        breadcrumbs={[{ label: "Cash drawer" }]}
      />

      {locations.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No active locations.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {openDrawers.map((entry) => (
            <Card key={entry.locationId}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {entry.locationName}
                  <Badge variant={entry.drawer ? "default" : "outline"} className="text-[10px]">
                    {entry.drawer ? "open" : "closed"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {entry.drawer ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Opened {formatDateTime(entry.drawer.openedAt, "UTC", "en-US")} by{" "}
                      {entry.drawer.openedByName} · float{" "}
                      {formatMoney(entry.drawer.openingFloatMinor, entry.drawer.currency, "en-US")}
                    </p>
                    <ul className="flex flex-col divide-y divide-border/60 text-sm">
                      {Object.entries(entry.drawer.methodTotals).length === 0 ? (
                        <li className="py-1.5 text-muted-foreground">
                          No payments recorded since open.
                        </li>
                      ) : (
                        Object.entries(entry.drawer.methodTotals).map(([method, minor]) => (
                          <li key={method} className="flex items-center justify-between py-1.5">
                            <span>{METHOD_LABELS[method] ?? method.toLowerCase()}</span>
                            <span className="font-mono tabular-nums">
                              {formatMoney(minor, entry.drawer!.currency, "en-US")}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                    <p className="text-sm">
                      Expected cash:{" "}
                      <span className="font-mono font-medium">
                        {formatMoney(
                          entry.drawer.expectedCashMinor,
                          entry.drawer.currency,
                          "en-US",
                        )}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({entry.drawer.paymentCount} payment
                        {entry.drawer.paymentCount === 1 ? "" : "s"} since open)
                      </span>
                    </p>
                    <DrawerControls
                      orgId={context.organizationId}
                      mode="close"
                      sessionId={entry.drawer.sessionId}
                      locationName={entry.locationName}
                      currency={entry.drawer.currency}
                    />
                  </>
                ) : (
                  <DrawerControls
                    orgId={context.organizationId}
                    mode="open"
                    locationId={entry.locationId}
                    locationName={entry.locationName}
                    currency={currency}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
            Close-out history · {openCount} drawer{openCount === 1 ? "" : "s"} still open
          </p>
          {closed.length === 0 ? (
            <p className="px-6 py-6 text-center text-sm text-muted-foreground">
              No closed sessions yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Closed</th>
                  <th className="px-4 py-3 font-medium">By</th>
                  <th className="px-4 py-3 font-medium">Counted</th>
                  <th className="px-4 py-3 font-medium">Expected</th>
                  <th className="px-4 py-3 font-medium">Over / short</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((session) => (
                  <tr key={session.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(session.closedAt, "UTC", "en-US")}
                    </td>
                    <td className="px-4 py-3">{session.closedByName}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {formatMoney(session.countedCashMinor, session.currency, "en-US")}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                      {formatMoney(session.expectedCashMinor, session.currency, "en-US")}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {session.overShortMinor === 0 ? (
                        <Badge variant="secondary" className="text-[10px]">
                          balanced
                        </Badge>
                      ) : (
                        <Badge
                          variant={session.overShortMinor > 0 ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {session.overShortMinor > 0 ? "+" : ""}
                          {formatMoney(session.overShortMinor, session.currency, "en-US")}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
