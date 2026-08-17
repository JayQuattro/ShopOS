"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Shop-side control for the customer's live repair tracker link: copy the
 * signed URL (text it to the customer), rotate it, or turn it off.
 */
export function TrackerLinkCard({
  workOrderId,
  canWrite,
}: {
  workOrderId: string;
  canWrite: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/work-orders/${workOrderId}/tracker-link`);
    if (res.ok) {
      const data = await res.json();
      setToken(data.token);
      setRevoked(Boolean(data.revoked));
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        await load();
        if (!cancelled) setLoading(false);
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load-once
  }, [workOrderId]);

  async function act(action: "get-or-create" | "regenerate" | "revoke") {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/tracker-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          link_revoked:
            "This link was turned off. Regenerate to issue a fresh URL to the customer.",
          work_order_not_found: "This work order no longer exists.",
        };
        throw new Error(messages[data.error] ?? "Action failed.");
      }
      if (action === "revoke") {
        setNotice("The customer's tracking link is now off.");
      } else {
        setNotice("New link issued — the old URL no longer works.");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  const trackerUrl = token ? `${window.location.origin}/track/${token}` : null;

  async function copy() {
    if (!trackerUrl) return;
    await navigator.clipboard.writeText(trackerUrl);
    setNotice("Link copied — paste it into a text or email to the customer.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Customer repair tracker</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert variant="info">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : revoked ? (
          <p className="text-sm text-muted-foreground">
            The tracking link is turned off. Regenerate to issue a fresh URL.
          </p>
        ) : trackerUrl ? (
          <>
            <p className="text-sm text-muted-foreground">
              Anyone with this link sees this job&rsquo;s live status, photos, and balance.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={trackerUrl} className="font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={copy}>
                Copy
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No link yet. Create one and text it to the customer so they can follow along.
          </p>
        )}

        {canWrite ? (
          <div className="flex gap-2">
            {!token && !revoked ? (
              <Button size="sm" onClick={() => void act("get-or-create")} disabled={pending}>
                Create link
              </Button>
            ) : null}
            {revoked ? (
              <Button size="sm" onClick={() => void act("regenerate")} disabled={pending}>
                Regenerate link
              </Button>
            ) : null}
            {token && !revoked ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void act("regenerate")}
                  disabled={pending}
                >
                  New URL
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void act("revoke")}
                  disabled={pending}
                >
                  Turn off
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
