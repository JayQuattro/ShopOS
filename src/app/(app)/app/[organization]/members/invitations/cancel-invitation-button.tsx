"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { membershipStrings } from "@/modules/memberships/ui/strings";

export function CancelInvitationButton({
  organizationId,
  invitationId,
}: {
  organizationId: string;
  invitationId: string;
}) {
  const [pending, setPending] = useState(false);

  async function handleCancel() {
    setPending(true);
    try {
      await fetch(
        `/api/organizations/${organizationId}/members/invitations?invitationId=${invitationId}`,
        {
          method: "DELETE",
          headers: { origin: window.location.origin },
        },
      );
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleCancel} disabled={pending}>
      {membershipStrings.cancelInvitation}
    </Button>
  );
}
