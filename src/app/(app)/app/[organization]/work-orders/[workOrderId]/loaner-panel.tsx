"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/i18n/formatters";

type Checkout = {
  id: string;
  assetId: string;
  assetName: string;
  checkedOutAt: string;
  checkedInAt: string | null;
  outMileage: number | null;
  inMileage: number | null;
  note: string | null;
};

type LoanerAsset = { id: string; displayName: string };

/**
 * Loaner tracking on a work order: check out a shop vehicle, see the open
 * loaner with mileage, check it back in.
 */
export function LoanerPanel({
  workOrderId,
  loanerAssets,
  canWrite,
  orgId,
  locationId,
  customerId,
}: {
  workOrderId: string;
  loanerAssets: ReadonlyArray<LoanerAsset>;
  canWrite: boolean;
  orgId: string;
  locationId: string;
  customerId: string;
}) {
  const [checkouts, setCheckouts] = useState<Checkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assetId, setAssetId] = useState(loanerAssets[0]?.id ?? "");
  // Reservation state
  const [reserveAssetId, setReserveAssetId] = useState("");
  const [reserveFrom, setReserveFrom] = useState("");
  const [reserveTo, setReserveTo] = useState("");
  const [reservePending, setReservePending] = useState(false);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const [outMileage, setOutMileage] = useState("");
  const [fuelOut, setFuelOut] = useState("");
  const [conditionNote, setConditionNote] = useState("");
  const [acknowledgedBy, setAcknowledgedBy] = useState("");

  async function load() {
    const res = await fetch(`/api/work-orders/${workOrderId}/loaners`);
    if (res.ok) {
      const data = await res.json();
      setCheckouts(data.checkouts ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/work-orders/${workOrderId}/loaners`);
          if (res.ok && !cancelled) {
            const data = await res.json();
            setCheckouts(data.checkouts ?? []);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workOrderId]);

  async function act(body: Record<string, unknown>, successNote: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/loaners`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          asset_already_out: "That loaner is already out with another customer.",
          work_order_already_has_loaner: "This job already has a loaner out — return it first.",
          already_checked_in: "That loaner is already returned.",
          asset_not_found: "That loaner no longer exists.",
        };
        throw new Error(messages[data.error] ?? "Action failed.");
      }
      setNotice(successNote);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  async function reserveLoaner() {
    if (!reserveAssetId || !reserveFrom || !reserveTo) return;
    setReservePending(true);
    setReserveError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/loaner-reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reserve",
          assetId: reserveAssetId,
          customerId,
          locationId,
          workOrderId,
          reservedFrom: new Date(reserveFrom).toISOString(),
          reservedTo: new Date(reserveTo).toISOString(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          asset_already_reserved: "That vehicle is already promised for part of this window.",
          asset_already_out: "That vehicle is currently checked out.",
          asset_not_fleet: "Only shop fleet vehicles can be reserved.",
          invalid_window: "The end must come after the start.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Could not reserve.");
      }
      setReserveAssetId("");
      setReserveFrom("");
      setReserveTo("");
      window.location.reload();
    } catch (e) {
      setReserveError(e instanceof Error ? e.message : "Could not reserve.");
    } finally {
      setReservePending(false);
    }
  }

  const open = checkouts.find((checkout) => checkout.checkedInAt === null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Loaner
          {open ? (
            <Badge variant="default" className="ml-2 text-[10px]">
              out
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>Shop vehicles lent to the customer during the repair.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canWrite && !open ? (
          <div className="flex flex-wrap items-end gap-2">
            <span className="w-full text-xs font-semibold text-muted-foreground">
              Reserve a loaner for later
            </span>
            <select
              value={reserveAssetId}
              onChange={(e) => setReserveAssetId(e.target.value)}
              disabled={reservePending}
              aria-label="Reserve vehicle"
              className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Vehicle…</option>
              {loanerAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.displayName}
                </option>
              ))}
            </select>
            <Input
              type="datetime-local"
              value={reserveFrom}
              onChange={(e) => setReserveFrom(e.target.value)}
              disabled={reservePending}
              aria-label="Reserve from"
              className="h-[var(--control-height)] w-44 text-sm"
            />
            <Input
              type="datetime-local"
              value={reserveTo}
              onChange={(e) => setReserveTo(e.target.value)}
              disabled={reservePending}
              aria-label="Reserve to"
              className="h-[var(--control-height)] w-44 text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={reservePending || !reserveAssetId || !reserveFrom || !reserveTo}
              onClick={() => void reserveLoaner()}
            >
              {reservePending ? "Reserving…" : "Reserve"}
            </Button>
            {reserveError ? (
              <p className="w-full text-xs text-destructive">{reserveError}</p>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <Alert variant="info">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : open ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{open.assetName}</p>
              <p className="text-xs text-muted-foreground">
                Out {formatDateTime(new Date(open.checkedOutAt), "UTC", "en-US")}
                {open.outMileage !== null ? ` · ${open.outMileage.toLocaleString()} mi` : ""}
                {open.note ? ` · ${open.note}` : ""}
              </p>
            </div>
            {canWrite ? (
              <CheckInForm
                pending={pending}
                onSubmit={(mileage) =>
                  act(
                    {
                      action: "check-in",
                      checkoutId: open.id,
                      ...(mileage !== "" ? { inMileage: Number(mileage) } : {}),
                    },
                    `${open.assetName} returned.`,
                  )
                }
              />
            ) : null}
          </div>
        ) : loanerAssets.length > 0 && canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm font-medium">
              Loaner vehicle
              <select
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                disabled={pending}
                className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
              >
                {loanerAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Out mileage
              <Input
                type="number"
                min={0}
                value={outMileage}
                onChange={(e) => setOutMileage(e.target.value)}
                placeholder="optional"
                className="w-28"
                disabled={pending}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Fuel %
              <Input
                type="number"
                min={0}
                max={100}
                value={fuelOut}
                onChange={(e) => setFuelOut(e.target.value)}
                placeholder="e.g. 75"
                className="w-20"
                disabled={pending}
              />
            </label>
            <label className="grid flex-1 gap-1 text-sm font-medium">
              Condition at pickup
              <Input
                value={conditionNote}
                onChange={(e) => setConditionNote(e.target.value)}
                placeholder="Scratch on rear door, full tank promised back…"
                disabled={pending}
              />
            </label>
            <label className="grid flex-1 gap-1 text-sm font-medium">
              Acknowledged by
              <Input
                value={acknowledgedBy}
                onChange={(e) => setAcknowledgedBy(e.target.value)}
                placeholder="Customer name at hand-off"
                disabled={pending}
              />
            </label>
            <Button
              size="sm"
              disabled={pending || !assetId}
              onClick={() =>
                void act(
                  {
                    action: "check-out",
                    assetId,
                    ...(outMileage !== "" ? { outMileage: Number(outMileage) } : {}),
                    ...(fuelOut !== "" ? { fuelOut: Number(fuelOut) } : {}),
                    ...(conditionNote.trim() ? { conditionNote: conditionNote.trim() } : {}),
                    ...(acknowledgedBy.trim() ? { acknowledgedBy: acknowledgedBy.trim() } : {}),
                  },
                  "Loaner checked out.",
                )
              }
            >
              Check out
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No loaner out. Add shop-owned vehicles (assets owned by your organization) to lend them.
          </p>
        )}

        {checkouts.filter((checkout) => checkout.checkedInAt !== null).length > 0 ? (
          <ul className="flex flex-col gap-1 border-t border-border pt-2">
            {checkouts
              .filter((checkout) => checkout.checkedInAt !== null)
              .map((checkout) => (
                <li key={checkout.id} className="text-xs text-muted-foreground">
                  {checkout.assetName} ·{" "}
                  {checkout.outMileage !== null && checkout.inMileage !== null
                    ? `${checkout.inMileage - checkout.outMileage} mi driven · `
                    : ""}
                  returned {formatDateTime(new Date(checkout.checkedInAt!), "UTC", "en-US")}
                </li>
              ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CheckInForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (mileage: string) => void;
}) {
  const [inMileage, setInMileage] = useState("");
  return (
    <div className="flex items-end gap-2">
      <label className="grid gap-1 text-sm font-medium">
        In mileage
        <Input
          type="number"
          min={0}
          value={inMileage}
          onChange={(e) => setInMileage(e.target.value)}
          placeholder="optional"
          className="w-28"
          disabled={pending}
        />
      </label>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => onSubmit(inMileage)}>
        Return
      </Button>
    </div>
  );
}
