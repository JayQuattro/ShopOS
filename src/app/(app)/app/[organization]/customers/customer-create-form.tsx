"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CustomerCreateForm({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("INDIVIDUAL");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          displayName,
          ...(email ? { primaryEmail: email } : {}),
          ...(phone ? { primaryPhone: phone } : {}),
          ...(reference ? { organizationReference: reference } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create customer.");
      }
      setOpen(false);
      setDisplayName("");
      setEmail("");
      setPhone("");
      setReference("");
      if (onCreated) {
        onCreated();
      } else {
        window.location.reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Add customer</Button>;
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-md gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="INDIVIDUAL">Individual</option>
        <option value="BUSINESS">Business</option>
      </select>
      <Input
        placeholder="Display name *"
        required
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        disabled={pending}
      />
      <Input
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={pending}
      />
      <Input
        placeholder="Phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        disabled={pending}
      />
      <Input
        placeholder="Reference (e.g. C-1001)"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        disabled={pending}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !displayName.trim()}>
          Create
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
