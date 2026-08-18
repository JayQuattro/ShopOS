"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Deposit = {
  id: string;
  amountMinor: string;
  currency: string;
  method: string;
  reference: string | null;
  receivedAt: string;
  appliedAt: string | null;
  note: string | null;
};

function money(minor: string, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(minor) / 100,
  );
}

const METHODS = [
  ["CASH", "Cash"],
  ["CARD_EXTERNAL", "Card"],
  ["CHECK", "Check"],
  ["BANK_TRANSFER", "Bank transfer"],
  ["OTHER", "Other"],
] as const;

/**
 * Deposits on one work order: take money at drop-off, and apply held deposits
 * to the invoice once it's issued (payment-record access required).
 */
export function DepositPanel({
  orgId,
  workOrderId,
  hasInvoice,
  canRecordMoney,
}: {
  orgId: string;
  workOrderId: string;
  hasInvoice: boolean;
  canRecordMoney: boolean;
}) {
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/organizations/${orgId}/deposits?workOrderId=${workOrderId}`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { deposits: Deposit[] };
          if (!cancelled) setDeposits(data.deposits);
        }
      } catch {
        if (!cancelled) setDeposits([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, workOrderId]);

  async function post(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const messages: Record<string, string> = {
          invoice_not_found: "This job has no invoice yet.",
          invoice_not_issued: "The invoice isn't issued yet.",
          deposit_already_applied: "That deposit is already applied.",
          deposit_exceeds_balance: "The deposit is larger than the invoice balance.",
          invalid_amount: "Enter an amount like 150.00",
        };
        throw new Error(messages[data.error ?? ""] ?? "Could not update deposits.");
      }
      const refresh = await fetch(
        `/api/organizations/${orgId}/deposits?workOrderId=${workOrderId}`,
      );
      if (refresh.ok) {
        const data = (await refresh.json()) as { deposits: Deposit[] };
        setDeposits(data.deposits);
      }
      setAmount("");
      setReference("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update deposits.");
    } finally {
      setPending(false);
    }
  }

  function submitRecord() {
    const parsed = Number(amount.trim().replace(/[$,]/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter an amount like 150.00");
      return;
    }
    void post({
      action: "record",
      workOrderId,
      amountMinor: Math.round(parsed * 100),
      currency: "USD",
      method,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    });
  }

  const held = deposits?.filter((deposit) => !deposit.appliedAt) ?? [];
  const totalHeld = held.reduce((sum, deposit) => sum + Number(deposit.amountMinor), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Deposits
          {held.length > 0 ? (
            <Badge variant="secondary" className="text-[10px]">
              holding {money(String(totalHeld), held[0]!.currency)}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {deposits === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : deposits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deposits on this job.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {deposits.map((deposit) => (
              <li
                key={deposit.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  <span className="font-mono">{money(deposit.amountMinor, deposit.currency)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {METHODS.find(([value]) => value === deposit.method)?.[1] ?? deposit.method}
                    {deposit.reference ? ` · ${deposit.reference}` : ""}
                  </span>
                </span>
                {deposit.appliedAt ? (
                  <Badge variant="secondary" className="text-[10px]">
                    applied to invoice
                  </Badge>
                ) : hasInvoice && canRecordMoney ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => void post({ action: "apply", depositId: deposit.id })}
                  >
                    Apply to invoice
                  </Button>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    held
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}

        {canRecordMoney ? (
          open ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <label className="grid gap-1 text-sm font-medium">
                Amount
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="150.00"
                  disabled={pending}
                  className="h-9 w-28 font-mono text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Method
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  disabled={pending}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {METHODS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid flex-1 gap-1 text-sm font-medium">
                Reference
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Auth code / check #"
                  disabled={pending}
                  className="h-9 text-sm"
                />
              </label>
              <Button type="button" disabled={pending} onClick={submitRecord}>
                {pending ? "Recording…" : "Take deposit"}
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              Take a deposit
            </Button>
          )
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
