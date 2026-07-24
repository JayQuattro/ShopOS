"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function RevokeAction({ grantId }: { grantId: string }): React.ReactElement {
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);

  async function handleRevoke() {
    if (!showReason) {
      setShowReason(true);
      return;
    }
    if (reason.trim().length < 10) return;
    setPending(true);
    try {
      await fetch(`/api/platform/operators/grants/${grantId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: window.location.origin },
        body: JSON.stringify({ reason }),
      });
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  if (showReason) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Reason for revocation (min 10 chars)"
          minLength={10}
          maxLength={500}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          disabled={pending}
          autoFocus
        />
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={handleRevoke}
          disabled={pending}
        >
          Confirm
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowReason(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleRevoke}>
      Revoke
    </Button>
  );
}
