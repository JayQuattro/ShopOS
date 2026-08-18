"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/i18n/formatters";

type Sublet = {
  id: string;
  vendorName: string;
  description: string;
  status: "sent" | "returned" | "cancelled";
  quotedMinor: string | null;
  actualMinor: string | null;
  sentAt: string;
  returnedAt: string | null;
};

/** Sublet/vendor work: outsourced jobs (machine shop, glass, calibration). */
export function SubletPanel({ workOrderId, canWrite }: { workOrderId: string; canWrite: boolean }) {
  const [sublets, setSublets] = useState<Sublet[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [description, setDescription] = useState("");
  const [quoted, setQuoted] = useState("");

  async function load() {
    const res = await fetch(`/api/work-orders/${workOrderId}/sublets`);
    if (res.ok) {
      const data = await res.json();
      setSublets(data.sublets ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/work-orders/${workOrderId}/sublets`);
          if (res.ok && !cancelled) {
            const data = await res.json();
            setSublets(data.sublets ?? []);
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
      const res = await fetch(`/api/work-orders/${workOrderId}/sublets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error === "invalid_transition"
            ? "That sublet can't change state."
            : "Action failed.",
        );
      }
      setNotice(successNote);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (vendorName.trim().length < 2 || description.trim().length < 3) return;
    await act(
      {
        action: "send",
        vendorName: vendorName.trim(),
        description: description.trim(),
        ...(quoted !== "" ? { quotedMinor: Math.round((Number(quoted) || 0) * 100) } : {}),
      },
      `Sent to ${vendorName.trim()}.`,
    );
    setVendorName("");
    setDescription("");
    setQuoted("");
    setOpen(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Sublet work</CardTitle>
          <CardDescription>Jobs outsourced to outside vendors.</CardDescription>
        </div>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setOpen((prev) => !prev)}>
            Send to vendor
          </Button>
        ) : null}
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

        {open && canWrite ? (
          <form onSubmit={send} className="grid gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap gap-2">
              <Input
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="Vendor (e.g. Precision Machine Shop)"
                required
                disabled={pending}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                value={quoted}
                onChange={(e) => setQuoted(e.target.value)}
                placeholder="Quoted $"
                className="w-28"
                disabled={pending}
              />
            </div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What they're doing (e.g. resurface rotors)"
              required
              disabled={pending}
            />
            <div>
              <Button type="submit" size="sm" disabled={pending}>
                Record sublet
              </Button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sublets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sublet work on this job.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {sublets.map((sublet) => (
              <li
                key={sublet.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <p className="text-sm font-medium">
                    {sublet.vendorName}
                    <Badge
                      variant={
                        sublet.status === "returned"
                          ? "default"
                          : sublet.status === "cancelled"
                            ? "secondary"
                            : "outline"
                      }
                      className="ml-2 text-[10px]"
                    >
                      {sublet.status}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sublet.description} · sent{" "}
                    {formatDateTime(new Date(sublet.sentAt), "UTC", "en-US")}
                    {sublet.quotedMinor
                      ? ` · quoted $${(Number(sublet.quotedMinor) / 100).toFixed(2)}`
                      : ""}
                    {sublet.actualMinor
                      ? ` · actual $${(Number(sublet.actualMinor) / 100).toFixed(2)}`
                      : ""}
                  </p>
                </div>
                {canWrite && sublet.status === "sent" ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const actual = window.prompt(
                          "Actual cost from the vendor ($, blank if none)",
                        );
                        if (actual === null) return;
                        void act(
                          {
                            action: "return",
                            subletId: sublet.id,
                            ...(actual.trim() !== ""
                              ? { actualMinor: Math.round((Number(actual) || 0) * 100) }
                              : {}),
                          },
                          `${sublet.vendorName} returned.`,
                        );
                      }}
                    >
                      Mark returned
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={pending}
                      onClick={() =>
                        void act({ action: "cancel", subletId: sublet.id }, "Sublet cancelled.")
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
