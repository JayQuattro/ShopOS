"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatMoney } from "@/i18n/formatters";

type TrackerView = {
  organizationName: string;
  workOrderNumber: string;
  customerName: string;
  statusLabel: string;
  readyForPickup: boolean;
  awaitingApproval: boolean;
  awaitingParts: boolean;
  authorizeUrl: string | null;
  timeline: Array<{ occurredAt: string; label: string }>;
  photos: Array<{ id: string; fileName: string }>;
  invoice: {
    number: string;
    status: string;
    currency: string;
    totalMinor: string;
    paidMinor: string;
  } | null;
};

export default function RepairTrackerPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [view, setView] = useState<TrackerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/track/${token}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(
            body.error === "link_revoked"
              ? "This tracking link was turned off by the shop. Call them if you need an update."
              : "This tracking link is invalid.",
          );
          return;
        }
        setView((await res.json()) as TrackerView);
      } catch {
        setError("Could not load your repair status.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading your repair status…</p>
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <Alert variant="destructive">
            <AlertTitle>Tracker unavailable</AlertTitle>
            <AlertDescription>{error ?? "This tracking link is invalid."}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const balanceMinor = view.invoice
    ? Math.max(0, Number(view.invoice.totalMinor) - Number(view.invoice.paidMinor))
    : null;

  return (
    <div className="flex min-h-svh flex-col items-center bg-background px-4 py-10">
      <div className="w-full max-w-lg">
        <h1 className="text-xl font-semibold tracking-tight">{view.organizationName}</h1>
        <p className="text-sm text-muted-foreground">
          Repair for {view.customerName} · Order {view.workOrderNumber}
        </p>

        <div className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Current status</p>
          <p className="mt-1 text-lg font-semibold">{view.statusLabel}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {view.awaitingApproval ? (
              <Badge variant="destructive">Your approval needed</Badge>
            ) : null}
            {view.awaitingParts ? <Badge variant="secondary">Waiting on parts</Badge> : null}
            {view.invoice && balanceMinor !== null && balanceMinor > 0 ? (
              <Badge variant="outline">Balance due</Badge>
            ) : null}
            {view.invoice && balanceMinor === 0 ? <Badge>Paid in full</Badge> : null}
          </div>
          {view.awaitingApproval && view.authorizeUrl ? (
            <a
              href={view.authorizeUrl}
              className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Review and approve work
            </a>
          ) : null}
        </div>

        {view.photos.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-sm font-semibold">Photos from the shop</h2>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {view.photos.map((photo) => (
                <a
                  key={photo.id}
                  href={`/api/public/track/${token}/attachments/${photo.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group block overflow-hidden rounded-lg border border-border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- served through the tracker-token route */}
                  <img
                    src={`/api/public/track/${token}/attachments/${photo.id}`}
                    alt={photo.fileName}
                    className="aspect-square w-full object-cover transition-opacity group-hover:opacity-90"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {view.invoice ? (
          <div className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Invoice {view.invoice.number}</h2>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-mono tabular-nums">
                {formatMoney(Number(view.invoice.totalMinor), view.invoice.currency, "en-US")}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Paid</span>
              <span className="font-mono tabular-nums">
                {formatMoney(Number(view.invoice.paidMinor), view.invoice.currency, "en-US")}
              </span>
            </div>
            {balanceMinor !== null && balanceMinor > 0 ? (
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-sm font-medium">
                <span>Balance due</span>
                <span className="font-mono tabular-nums">
                  {formatMoney(balanceMinor, view.invoice.currency, "en-US")}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Progress</h2>
          <ol className="mt-3 flex flex-col gap-3">
            {view.timeline.length === 0 ? (
              <li className="text-sm text-muted-foreground">No updates yet.</li>
            ) : (
              view.timeline.map((entry, index) => (
                <li key={index} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/70" />
                  <div className="flex flex-col">
                    <span className="text-sm">{entry.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(new Date(entry.occurredAt), "UTC", "en-US")}
                    </span>
                  </div>
                </li>
              ))
            )}
          </ol>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          This page updates as work progresses. Questions? Call {view.organizationName}.
        </p>
      </div>
    </div>
  );
}
