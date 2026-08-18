"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Settings = {
  notifyEstimateEmail: boolean;
  notifyDecisionReceiptEmail: boolean;
  notifyInvoiceEmail: boolean;
  notifyPaymentReceiptEmail: boolean;
  notifyAppointmentReminders: boolean;
  notifyPmReminders: boolean;
  notifyReviewRequests: boolean;
  appointmentReminderLeadHours: number;
  noShowCutoffHours: number;
  pmReminderCooldownDays: number;
};

const TOGGLES: ReadonlyArray<{ key: keyof Settings; label: string; detail: string }> = [
  {
    key: "notifyEstimateEmail",
    label: "Estimate & change-order emails",
    detail: "Sent when work is presented for approval.",
  },
  {
    key: "notifyDecisionReceiptEmail",
    label: "Decision receipt emails",
    detail: "Confirmation of exactly what was approved or declined.",
  },
  {
    key: "notifyInvoiceEmail",
    label: "Invoice emails",
    detail: "Sent when an invoice is issued.",
  },
  {
    key: "notifyPaymentReceiptEmail",
    label: "Payment receipt emails",
    detail: "Sent when a payment is recorded.",
  },
  {
    key: "notifyAppointmentReminders",
    label: "Appointment reminder texts",
    detail: "Includes no-show follow-ups.",
  },
  {
    key: "notifyPmReminders",
    label: "Maintenance-due texts",
    detail: "Texts customers when scheduled service comes due.",
  },
  {
    key: "notifyReviewRequests",
    label: "Review request texts",
    detail: "Thank-you with a review ask when a job closes.",
  },
];

export function NotificationsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const orgId = window.location.pathname.split("/")[2] ?? "";
          const res = await fetch(`/api/organizations/${orgId}/settings/notifications`);
          if (res.ok && !cancelled) {
            setSettings((await res.json()) as Settings);
          } else if (!cancelled) {
            const data = await res.json().catch(() => ({}));
            setError(
              data.error === "organization_denied"
                ? "Switch into this organization first."
                : "Could not load settings.",
            );
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
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const orgId = window.location.pathname.split("/")[2] ?? "";
      const res = await fetch(`/api/organizations/${orgId}/settings/notifications`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error === "invalid_lead_hours"
            ? "Reminder lead must be 1–168 hours."
            : "Could not save settings.",
        );
      }
      setSuccess("Notification settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!settings) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? "Settings unavailable."}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={save} className="grid gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="info">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer messages</CardTitle>
          <CardDescription>Turn any message family off entirely.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {TOGGLES.map((toggle) => (
            <label key={toggle.key} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={Boolean(settings[toggle.key])}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, [toggle.key]: e.target.checked } : prev))
                }
                disabled={pending}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="font-medium">{toggle.label}</span>
                <span className="block text-muted-foreground">{toggle.detail}</span>
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timing</CardTitle>
          <CardDescription>When automated messages go out.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-medium">
            Reminder lead (hours)
            <Input
              type="number"
              min={1}
              max={168}
              value={settings.appointmentReminderLeadHours}
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? {
                        ...prev,
                        appointmentReminderLeadHours: Number(e.target.value) || 24,
                      }
                    : prev,
                )
              }
              disabled={pending}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            No-show cutoff (hours)
            <Input
              type="number"
              min={1}
              max={48}
              value={settings.noShowCutoffHours}
              onChange={(e) =>
                setSettings((prev) =>
                  prev ? { ...prev, noShowCutoffHours: Number(e.target.value) || 2 } : prev,
                )
              }
              disabled={pending}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Maintenance re-text gap (days)
            <Input
              type="number"
              min={1}
              max={365}
              value={settings.pmReminderCooldownDays}
              onChange={(e) =>
                setSettings((prev) =>
                  prev ? { ...prev, pmReminderCooldownDays: Number(e.target.value) || 30 } : prev,
                )
              }
              disabled={pending}
            />
          </label>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
