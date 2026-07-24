"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/i18n/formatters";

type InvoiceData = {
  id: string | null;
  number: string | null;
  status: string | null;
  totalMinor: string | null;
  paidMinor: string | null;
  currency: string;
};

export function InvoicePanel({
  workOrderId,
  invoice: initialInvoice,
}: {
  workOrderId: string;
  invoice: InvoiceData;
}) {
  const [invoice, setInvoice] = useState(initialInvoice);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");

  async function createInvoice() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed");
      }
      const data = await res.json();
      setInvoice({
        id: data.invoiceId,
        number: data.number,
        status: "DRAFT",
        totalMinor: "0",
        paidMinor: "0",
        currency: "USD",
      });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create invoice.");
    } finally {
      setPending(false);
    }
  }

  async function issueInvoice() {
    if (!invoice.id) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/issue`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed");
      setInvoice((prev) => ({ ...prev, status: "ISSUED" }));
      window.location.reload();
    } catch {
      setError("Could not issue the invoice.");
    } finally {
      setPending(false);
    }
  }

  async function recordPayment() {
    if (!invoice.id || !paymentAmount) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountMinor: parseInt(paymentAmount, 10),
          method: paymentMethod,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed");
      }
      const data = await res.json();
      setInvoice((prev) => ({ ...prev, status: data.invoiceStatus }));
      setPaymentAmount("");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record payment.");
    } finally {
      setPending(false);
    }
  }

  if (!invoice.id) {
    return (
      <div className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <p className="text-sm text-muted-foreground">No invoice yet.</p>
        <Button variant="outline" size="sm" onClick={createInvoice} disabled={pending}>
          Create invoice from work order
        </Button>
      </div>
    );
  }

  const balance = invoice.totalMinor
    ? Number(invoice.totalMinor) - Number(invoice.paidMinor ?? "0")
    : 0;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Invoice #</p>
          <p className="font-mono font-medium">{invoice.number}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <Badge
            variant={
              invoice.status === "PAID"
                ? "default"
                : invoice.status === "DRAFT"
                  ? "secondary"
                  : "outline"
            }
          >
            {invoice.status?.toLowerCase()}
          </Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="font-mono font-medium tabular-nums">
            {formatMoney(Number(invoice.totalMinor ?? "0"), invoice.currency, "en-US")}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Balance</p>
          <p className="font-mono font-medium tabular-nums">
            {formatMoney(balance, invoice.currency, "en-US")}
          </p>
        </div>
      </div>

      {invoice.status === "DRAFT" ? (
        <Button variant="default" size="sm" onClick={issueInvoice} disabled={pending}>
          Issue invoice
        </Button>
      ) : null}

      {(invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") && balance > 0 ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <Input
            type="number"
            placeholder="Amount (¢)"
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            className="w-32"
          />
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="CASH">Cash</option>
            <option value="CARD_EXTERNAL">Card</option>
            <option value="CHECK">Check</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="OTHER">Other</option>
          </select>
          <Button size="sm" onClick={recordPayment} disabled={pending || !paymentAmount}>
            Record payment
          </Button>
        </div>
      ) : null}
    </div>
  );
}
