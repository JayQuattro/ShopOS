"use client";

import { useState } from "react";

/** Toggles a customer between on-account billing and pay-at-pickup. */
export function AccountToggle({
  orgId,
  customerId,
  isAccount,
}: {
  orgId: string;
  customerId: string;
  isAccount: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/customers/${customerId}/account`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAccountCustomer: !isAccount }),
      });
      if (!res.ok) throw new Error("Could not update the account flag.");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the account flag.");
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        {pending ? "Updating…" : isAccount ? "Move to pay-at-pickup" : "Bill on account"}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
