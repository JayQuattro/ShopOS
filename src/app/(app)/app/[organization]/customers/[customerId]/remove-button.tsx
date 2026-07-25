"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function RemoveButton({ apiPath, label }: { apiPath: string; label: string }) {
  const [pending, setPending] = useState(false);

  async function handleRemove() {
    if (!confirm(`Remove ${label}?`)) return;
    setPending(true);
    try {
      const res = await fetch(apiPath, { method: "DELETE" });
      if (res.ok) window.location.reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-destructive"
      onClick={handleRemove}
      disabled={pending}
      aria-label={`Remove ${label}`}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
