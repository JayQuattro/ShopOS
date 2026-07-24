"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { membershipStrings } from "@/modules/memberships/ui/strings";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "advisor", label: "Advisor" },
  { value: "technician", label: "Technician" },
  { value: "parts", label: "Parts" },
  { value: "administrator", label: "Administrator" },
] as const;

export function InviteMemberDialog({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<string>("advisor");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: window.location.origin },
        body: JSON.stringify({ email, roleKey }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? membershipStrings.errors.generic);
        return;
      }
      setOpen(false);
      setEmail("");
      setRoleKey("advisor");
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button variant="default" onClick={() => setOpen(true)}>
        {membershipStrings.invite}
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-sm gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <label htmlFor="invite-email" className="text-sm font-medium">
        {membershipStrings.inviteEmailLabel}
      </label>
      <Input
        id="invite-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={pending}
      />
      <label htmlFor="invite-role" className="text-sm font-medium">
        {membershipStrings.inviteRoleLabel}
      </label>
      <select
        id="invite-role"
        value={roleKey}
        onChange={(e) => setRoleKey(e.target.value)}
        disabled={pending}
        className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
      >
        {ROLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {membershipStrings.inviteSubmit}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          {membershipStrings.inviteCancel}
        </Button>
      </div>
    </form>
  );
}
