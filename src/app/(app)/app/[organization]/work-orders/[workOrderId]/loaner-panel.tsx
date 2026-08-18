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
}: {
  workOrderId: string;
  loanerAssets: ReadonlyArray<LoanerAsset>;
  canWrite: boolean;
}) {
  const [checkouts, setCheckouts] = useState<Checkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assetId, setAssetId] = useState(loanerAssets[0]?.id ?? "");
  const [outMileage, setOutMileage] = useState("");

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
            <Button
              size="sm"
              disabled={pending || !assetId}
              onClick={() =>
                void act(
                  {
                    action: "check-out",
                    assetId,
                    ...(outMileage !== "" ? { outMileage: Number(outMileage) } : {}),
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
