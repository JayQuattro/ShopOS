"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { membershipStrings } from "@/modules/memberships/ui/strings";

/**
 * Client island for the activate/deactivate action. Posts to the membership
 * PATCH endpoint and reloads on success so the server-rendered status updates.
 */
export function MembershipActions({
  organizationId,
  membershipId,
  active,
}: {
  organizationId: string;
  membershipId: string;
  active: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function handleToggle() {
    setPending(true);
    try {
      await fetch(`/api/organizations/${organizationId}/members/${membershipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", origin: window.location.origin },
        body: JSON.stringify({ active: !active }),
      });
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleToggle} disabled={pending}>
      {active ? membershipStrings.deactivate : membershipStrings.reactivate}
    </Button>
  );
}
