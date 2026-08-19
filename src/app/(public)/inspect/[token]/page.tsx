"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type InspectView = {
  organizationName: string;
  contactPhone: string | null;
  workOrderNumber: string;
  customerName: string;
  title: string;
  completedAt: string | null;
  items: Array<{
    id: string;
    zone: string | null;
    component: string;
    condition: "OK" | "WATCH" | "REPLACE" | "NA";
    note: string | null;
    attachments: Array<{ id: string; fileName: string; contentType: string }>;
  }>;
};

const CONDITION_META: Record<
  InspectView["items"][number]["condition"],
  { label: string; className: string }
> = {
  OK: {
    label: "Good",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  WATCH: {
    label: "Watch",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  REPLACE: {
    label: "Needs replacement",
    className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  NA: { label: "Not checked", className: "border-border text-muted-foreground" },
};

export default function InspectionSharePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [view, setView] = useState<InspectView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/inspect/${token}`);
        if (!res.ok) {
          setError("This inspection link is invalid. Call the shop if you need it again.");
          return;
        }
        setView(await res.json());
      } catch {
        setError("Could not load this inspection.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading your inspection…</p>
        ) : (
          content(error, view, token)
        )}
      </div>
    </div>
  );
}

function content(error: string | null, view: InspectView | null, token: string) {
  if (error || !view) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Inspection unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  const needsAttention = view.items.filter((item) => item.condition === "REPLACE").length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {view.organizationName}
        </p>
        <h1 className="text-xl font-semibold">{view.title}</h1>
        <p className="text-sm text-muted-foreground">
          {view.customerName} · {view.workOrderNumber}
          {view.completedAt
            ? ` · completed ${new Date(view.completedAt).toLocaleDateString()}`
            : ""}
        </p>
      </header>

      {needsAttention > 0 ? (
        <Alert>
          <AlertTitle>
            {needsAttention} item{needsAttention === 1 ? "" : "s"} need
            {needsAttention === 1 ? "s" : ""} attention
          </AlertTitle>
          <AlertDescription>
            Your advisor will walk you through the details and send an estimate for anything you
            approve.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTitle>Everything looks good</AlertTitle>
          <AlertDescription>No items flagged for replacement in this inspection.</AlertDescription>
        </Alert>
      )}

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {view.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {item.zone ? (
                  <span className="mr-1 font-mono text-xs text-muted-foreground">{item.zone}</span>
                ) : null}
                {item.component}
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CONDITION_META[item.condition].className}`}
              >
                {CONDITION_META[item.condition].label}
              </span>
            </div>
            {item.note ? <p className="text-sm text-muted-foreground">{item.note}</p> : null}
            {item.attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {item.attachments.map((attachment) =>
                  attachment.contentType.startsWith("image/") ? (
                    <a
                      key={attachment.id}
                      href={`/api/public/inspect/${token}/attachments/${attachment.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-md border border-border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/public/inspect/${token}/attachments/${attachment.id}`}
                        alt={item.component}
                        className="h-24 w-32 object-cover"
                      />
                    </a>
                  ) : (
                    <a
                      key={attachment.id}
                      href={`/api/public/inspect/${token}/attachments/${attachment.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-24 w-32 items-center justify-center rounded-md border border-border text-2xl"
                      aria-label={`Video: ${item.component}`}
                    >
                      🎬
                    </a>
                  ),
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {view.contactPhone ? (
        <p className="text-sm text-muted-foreground">
          Questions? Call the shop at{" "}
          <a
            className="text-link underline-offset-4 hover:underline"
            href={`tel:${view.contactPhone}`}
          >
            {view.contactPhone}
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
