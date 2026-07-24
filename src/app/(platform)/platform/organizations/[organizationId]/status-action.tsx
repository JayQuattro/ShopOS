"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function OrganizationStatusAction({
  organizationId,
  currentStatus,
}: {
  organizationId: string;
  currentStatus: "ACTIVE" | "SUSPENDED";
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const targetStatus = currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";

  async function changeStatus() {
    setSubmitting(true);
    setError(null);
    const response = await fetch(`/api/platform/organizations/${organizationId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: targetStatus, reason }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? "The lifecycle state could not be changed.");
      setSubmitting(false);
      return;
    }
    setReason("");
    setSubmitting(false);
    router.refresh();
  }

  return (
    <div className="grid min-w-72 gap-2 rounded-lg border border-border bg-card p-4">
      <label className="grid gap-2 text-xs font-medium text-muted-foreground">
        Required reason
        <Input
          value={reason}
          minLength={10}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          placeholder={
            targetStatus === "SUSPENDED" ? "Reason for suspension" : "Reason for reactivation"
          }
        />
      </label>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button
        variant={targetStatus === "SUSPENDED" ? "destructive" : "default"}
        disabled={reason.trim().length < 10 || submitting}
        onClick={changeStatus}
      >
        {submitting
          ? "Updating…"
          : targetStatus === "SUSPENDED"
            ? "Suspend organization"
            : "Reactivate organization"}
      </Button>
    </div>
  );
}
