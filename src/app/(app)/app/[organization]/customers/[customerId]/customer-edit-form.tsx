"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CustomerEditForm({
  customerId,
  initialDisplayName,
  initialEmail,
  initialPhone,
  initialReference,
  initialInternalNotes,
  canWrite,
}: {
  customerId: string;
  initialDisplayName: string;
  initialEmail: string;
  initialPhone: string;
  initialReference: string;
  initialInternalNotes: string;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [reference, setReference] = useState(initialReference);
  const [internalNotes, setInternalNotes] = useState(initialInternalNotes);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (displayName !== initialDisplayName) body.displayName = displayName;
      if (email !== initialEmail) body.primaryEmail = email || null;
      if (phone !== initialPhone) body.primaryPhone = phone || null;
      if (reference !== initialReference) body.organizationReference = reference;
      if (internalNotes !== initialInternalNotes) body.internalNotes = internalNotes || null;

      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
      setEditing(false);
      window.location.reload();
    } catch {
      setError("Could not save changes.");
    } finally {
      setPending(false);
    }
  }

  if (!canWrite) return null;

  if (!editing) {
    return (
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        Edit
      </Button>
    );
  }

  return (
    <form onSubmit={handleSave} className="grid gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">
          Display name
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Reference
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Email
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Phone
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={pending} />
        </label>
      </div>
      <label className="grid gap-1 text-sm font-medium">
        Internal notes
        <textarea
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          disabled={pending}
          className="min-h-20 rounded-md border border-input bg-background p-3 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save changes
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditing(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
