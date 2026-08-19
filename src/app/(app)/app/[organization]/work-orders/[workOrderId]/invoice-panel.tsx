"use client";

import { useEffect, useState } from "react";

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
  paymentUrl: string | null;
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
  const [paymentUrl, setPaymentUrl] = useState(initialInvoice.paymentUrl);
  const [linkPending, setLinkPending] = useState(false);
  const [tenders, setTenders] = useState<Array<{ amount: string; method: string }>>([
    { amount: "", method: "CASH" },
  ]);
  const [payments, setPayments] = useState<
    Array<{
      id: string;
      method: string;
      amountMinor: string;
      refundableMinor: string;
      receivedAt: string;
    }>
  >([]);
  const [refundPending, setRefundPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!invoice.id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/invoices/${invoice.id}/refunds`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (!cancelled) setPayments(data.payments ?? []);
        }
      } catch {
        /* refunds are optional chrome */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice.id, invoice.paidMinor]);

  async function refund(paymentId: string, refundableMinor: string) {
    const refundable = Number(refundableMinor) / 100;
    const entered = window.prompt(
      `Refund amount (up to ${refundable.toFixed(2)})?`,
      refundable.toFixed(2),
    );
    if (entered === null) return;
    const amountMinor = Math.round(Number(entered.replace(/[$,]/g, "")) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return;
    const reason = window.prompt("Reason (shown on the statement)?") ?? undefined;
    setRefundPending(paymentId);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId,
          amountMinor,
          ...(reason && reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          refund_exceeds_payment: "That is more than is left to refund on this payment.",
          processor_unavailable:
            "Connect the processor in Settings → Payments to refund card payments.",
          processor_refund_failed: "The processor rejected the refund. Check the account.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Could not refund.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refund.");
      setRefundPending(null);
    }
  }

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
        paymentUrl: null,
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

  async function createPaymentLink() {
    if (!invoice.id) return;
    setLinkPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/payment-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/app/${window.location.pathname.split("/")[2]}/work-orders/${workOrderId}`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          no_processor: "Connect a payment processor in Settings → Payments first.",
          invoice_not_issued: "Issue the invoice before creating a payment link.",
          invoice_already_paid: "This invoice is already paid in full.",
          provider_error: "The processor rejected the request. Check the credentials.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Could not create the payment link.");
      }
      const data = await res.json();
      setPaymentUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the payment link.");
    } finally {
      setLinkPending(false);
    }
  }

  async function recordPayment() {
    if (!invoice.id) return;
    const parsed = tenders
      .map((tender) => ({
        amountMinor: Math.round(Number(tender.amount.trim().replace(/[$,]/g, "")) * 100),
        method: tender.method,
      }))
      .filter((tender) => Number.isFinite(tender.amountMinor) && tender.amountMinor > 0);
    if (parsed.length === 0) {
      setError("Enter at least one tender amount, like 150.00");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenders: parsed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          payment_exceeds_balance: "The tenders add up to more than the balance.",
          invalid_tenders: "Check the tender amounts.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Failed");
      }
      const data = await res.json();
      setInvoice((prev) => ({ ...prev, status: data.invoiceStatus }));
      setTenders([{ amount: "", method: "CASH" }]);
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
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {paymentUrl ? (
            <>
              <a
                href={paymentUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Customer payment link ↗
              </a>
              <span className="text-xs text-muted-foreground">Send this to the customer</span>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={createPaymentLink}
                disabled={linkPending}
              >
                {linkPending ? "Creating…" : "Create payment link"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {formatMoney(balance, invoice.currency, "en-US")} hosted by your processor
              </span>
            </>
          )}
        </div>
      ) : null}

      {payments.length > 0 ? (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          {payments.map((payment) => (
            <div
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                <span className="font-mono tabular-nums">
                  {formatMoney(Number(payment.amountMinor), invoice.currency, "en-US")}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {payment.method === "CARD_EXTERNAL" ? "card" : payment.method.toLowerCase()}
                </span>
              </span>
              {Number(payment.refundableMinor) > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={refundPending === payment.id}
                  onClick={() => void refund(payment.id, payment.refundableMinor)}
                >
                  {refundPending === payment.id ? "Refunding…" : "Refund"}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">refunded</span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {(invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") && balance > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {tenders.map((tender, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Input
                inputMode="decimal"
                placeholder={index === 0 ? "Amount (e.g. 150.00)" : "Amount"}
                value={tender.amount}
                onChange={(e) =>
                  setTenders((prev) =>
                    prev.map((t, i) => (i === index ? { ...t, amount: e.target.value } : t)),
                  )
                }
                className="w-32 font-mono"
                aria-label={`Tender ${index + 1} amount`}
              />
              <select
                value={tender.method}
                onChange={(e) =>
                  setTenders((prev) =>
                    prev.map((t, i) => (i === index ? { ...t, method: e.target.value } : t)),
                  )
                }
                aria-label={`Tender ${index + 1} method`}
                className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="CASH">Cash</option>
                <option value="CARD_EXTERNAL">Card</option>
                <option value="CHECK">Check</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="OTHER">Other</option>
              </select>
              {tenders.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTenders((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`Remove tender ${index + 1}`}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setTenders((prev) => [...prev, { amount: "", method: "CARD_EXTERNAL" }])
              }
            >
              Split — another method
            </Button>
            <Button size="sm" onClick={recordPayment} disabled={pending}>
              Record payment{tenders.length > 1 ? ` (${tenders.length} tenders)` : ""}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
