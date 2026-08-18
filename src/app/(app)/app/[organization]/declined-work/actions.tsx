"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Per-row re-quote actions: draft a change order copying the declined line,
 * or draft and present it immediately (the standard change-order flow —
 * email/text, approval link — takes over).
 */
export function DeclinedWorkActions({
  decisionId,
  description,
}: {
  decisionId: string;
  description: string;
}) {
  const [pending, setPending] = useState<"draft" | "present" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reQuote(present: boolean) {
    setPending(present ? "present" : "draft");
    setError(null);
    try {
      const res = await fetch(`/api/follow-ups/declined/${decisionId}/re-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(present ? { present: true } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          change_order_pending_exists: "Resolve the pending change order on this job first.",
          work_order_not_authorized: "This job isn't authorized for change orders yet.",
          decision_not_found: "That declined item no longer exists.",
        };
        throw new Error(messages[data.error] ?? "Could not re-quote.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not re-quote.");
      setPending(null);
    }
  }

  return (
    <span className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending !== null}
        onClick={() => void reQuote(false)}
        title={`Copy "${description}" into a draft change order`}
      >
        {pending === "draft" ? "…" : "Re-quote"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending !== null}
        onClick={() => void reQuote(true)}
        title="Draft and send for approval immediately"
      >
        {pending === "present" ? "…" : "Send now"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
