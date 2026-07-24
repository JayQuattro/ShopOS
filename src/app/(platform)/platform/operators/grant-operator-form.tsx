"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GrantOperatorForm(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [role, setRole] = useState("VIEWER");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/platform/operators/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: window.location.origin },
        body: JSON.stringify({ targetUserId, role, reason }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to grant operator role.");
        return;
      }
      setOpen(false);
      setTargetUserId("");
      setRole("VIEWER");
      setReason("");
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Grant operator role</Button>;
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-md gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <label htmlFor="target-user" className="text-sm font-medium">
        Target user ID
      </label>
      <Input
        id="target-user"
        required
        value={targetUserId}
        onChange={(e) => setTargetUserId(e.target.value)}
        disabled={pending}
        placeholder="00000000-0000-4000-8000-…"
      />
      <label htmlFor="grant-role" className="text-sm font-medium">
        Role
      </label>
      <select
        id="grant-role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        disabled={pending}
        className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="VIEWER">Viewer</option>
        <option value="OPERATOR">Operator</option>
        <option value="ADMIN">Admin</option>
      </select>
      <label htmlFor="grant-reason" className="text-sm font-medium">
        Reason (10-500 chars)
      </label>
      <Input
        id="grant-reason"
        required
        minLength={10}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={pending}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Grant
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
