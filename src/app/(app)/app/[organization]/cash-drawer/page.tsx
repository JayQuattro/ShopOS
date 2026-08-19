import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDateTime, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  getOpenCashDrawers,
  listClosedCashDrawers,
  type OpenDrawerState,
} from "@/modules/billing/cash-drawer-service";
import { resolveRegionalSettings } from "@/modules/organizations/regional-settings";
import { DrawerControls } from "./drawer-controls";

export const dynamic = "force-dynamic";

const METHOD_LABELS: Readonly<Record<string, string>> = {
  CASH: "Cash",
  CARD_EXTERNAL: "Card",
  CHECK: "Check",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

function tillTitle(drawer: OpenDrawerState): string {
  if (drawer.ownerName) return drawer.label ?? `${drawer.ownerName}'s till`;
  return drawer.label ?? "Shared drawer";
}

function TillCard({
  drawer,
  orgId,
  locationName,
}: {
  drawer: OpenDrawerState;
  orgId: string;
  locationName: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>
            {tillTitle(drawer)}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{locationName}</span>
          </span>
          <Badge variant="default" className="text-[10px]">
            open
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Opened {formatDateTime(drawer.openedAt, "UTC", "en-US")} by {drawer.openedByName} · float{" "}
          {formatMoney(drawer.openingFloatMinor, drawer.currency, "en-US")}
          {drawer.ownerName ? ` · ${drawer.ownerName}'s money` : ""}
        </p>
        <ul className="flex flex-col divide-y divide-border/60 text-sm">
          {Object.entries(drawer.methodTotals).length === 0 ? (
            <li className="py-1.5 text-muted-foreground">No payments in this till yet.</li>
          ) : (
            Object.entries(drawer.methodTotals).map(([method, minor]) => (
              <li key={method} className="flex items-center justify-between py-1.5">
                <span>{METHOD_LABELS[method] ?? method.toLowerCase()}</span>
                <span className="font-mono tabular-nums">
                  {formatMoney(minor, drawer.currency, "en-US")}
                </span>
              </li>
            ))
          )}
        </ul>
        <p className="text-sm">
          Expected cash:{" "}
          <span className="font-mono font-medium">
            {formatMoney(drawer.expectedCashMinor, drawer.currency, "en-US")}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            ({drawer.paymentCount} payment{drawer.paymentCount === 1 ? "" : "s"} in this till)
          </span>
        </p>
        <DrawerControls
          orgId={orgId}
          mode="close"
          sessionId={drawer.sessionId}
          locationName={tillTitle(drawer)}
          currency={drawer.currency}
        />
      </CardContent>
    </Card>
  );
}

/**
 * The nightly close-out: every open till (each cashier's own plus the shared
 * house drawer) with its own method totals and count-the-cash close, and the
 * over/short history for reconciliation.
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

  const [locations, openDrawers, closed] = await Promise.all([
    db.location.findMany({
      where: {
        organizationId: context.organizationId,
        active: true,
        ...(context.organizationWideLocationAccess
          ? {}
          : { id: { in: [...context.allowedLocationIds] } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    getOpenCashDrawers({ db, context }),
    listClosedCashDrawers({ db, context }),
  ]);
  const orgId = context.organizationId;
  const effectiveByLocation = new Map(
    await Promise.all(
      locations.map(async (location) => {
        const regional = await resolveRegionalSettings(db, context.organizationId, location.id);
        return [location.id, regional.currency] as const;
      }),
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cash drawer"
        description="Each cashier can run their own till alongside the shared drawer — count and close them independently."
        breadcrumbs={[{ label: "Cash drawer" }]}
      />

      {locations.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No active locations.
          </CardContent>
        </Card>
      ) : (
        locations.map((location) => {
          const drawers = openDrawers.filter((drawer) => drawer.locationId === location.id);
          const sharedOpen = drawers.some((drawer) => drawer.ownerUserId === null);
          const myOpen = drawers.some((drawer) => drawer.ownerUserId === context.actorId);
          return (
            <div key={location.id} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{location.name}</h2>
                <span className="font-mono text-xs text-muted-foreground">
                  {drawers.length} open till{drawers.length === 1 ? "" : "s"}
                </span>
              </div>
              {drawers.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {drawers.map((drawer) => (
                    <TillCard
                      key={drawer.sessionId}
                      drawer={drawer}
                      orgId={orgId}
                      locationName={location.name}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing open at this location.</p>
              )}
              <div className="flex flex-wrap gap-3">
                {!myOpen ? (
                  <DrawerControls
                    orgId={orgId}
                    mode="open"
                    locationId={location.id}
                    locationName={`my till at ${location.name}`}
                    currency={effectiveByLocation.get(location.id) ?? "USD"}
                  />
                ) : null}
                {!sharedOpen ? (
                  <DrawerControls
                    orgId={orgId}
                    mode="open"
                    locationId={location.id}
                    locationName={`the shared drawer at ${location.name}`}
                    currency={effectiveByLocation.get(location.id) ?? "USD"}
                    shared
                  />
                ) : null}
              </div>
            </div>
          );
        })
      )}

      <Card>
        <CardContent className="p-0">
          <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
            Close-out history
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
                  <th className="px-4 py-3 font-medium">Till</th>
                  <th className="px-4 py-3 font-medium">By</th>
                  <th className="px-4 py-3 font-medium">Counted</th>
                  <th className="px-4 py-3 font-medium">Over / short</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((session) => (
                  <tr key={session.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(session.closedAt, "UTC", "en-US")}
                    </td>
                    <td className="px-4 py-3">
                      {session.ownerName
                        ? (session.label ?? `${session.ownerName}'s till`)
                        : (session.label ?? "Shared drawer")}
                    </td>
                    <td className="px-4 py-3">{session.closedByName}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {formatMoney(session.countedCashMinor, session.currency, "en-US")}
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
