"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AdapterDefinition = {
  key: string;
  displayName: string;
  description: string;
  status: "live" | "planned";
  configFields: Array<{ name: string; label: string; required: boolean; placeholder?: string }>;
  secretFields: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
  }>;
};

type Connector = { id: string; adapterKey: string; displayName: string; status: string } | null;

/** BYO processor configuration (ADR 0016): one active adapter per shop. */
export function PaymentsSettingsForm({ organizationId }: { organizationId: string }) {
  const [adapters, setAdapters] = useState<AdapterDefinition[]>([]);
  const [connector, setConnector] = useState<Connector>(null);
  const [adapterKey, setAdapterKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/organizations/${organizationId}/settings/payments`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setAdapters(data.adapters ?? []);
          setConnector(data.connector ?? null);
          if (data.connector) {
            setAdapterKey(data.connector.adapterKey);
            setDisplayName(data.connector.displayName);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const selected = adapters.find((a) => a.key === adapterKey);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/settings/payments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapterKey,
          displayName: displayName || selected.displayName,
          configuration: config,
          secret,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          invalid_configuration: "Fill in the required fields.",
          invalid_adapter: "Pick a processor.",
          adapter_not_available: "That processor isn't available yet.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Could not save.");
      }
      setSuccess("Processor connected. Payment links are live on new invoices.");
      setSecret({});
      const refresh = await fetch(`/api/organizations/${organizationId}/settings/payments`);
      if (refresh.ok) setConnector((await refresh.json()).connector ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <form onSubmit={save} className="grid gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="info">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      {connector ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected processor</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4">
            <span className="font-medium">{connector.displayName}</span>
            <Badge variant="outline">{connector.adapterKey}</Badge>
            <Badge variant={connector.status === "active" ? "default" : "secondary"}>
              {connector.status}
            </Badge>
          </CardContent>
        </Card>
      ) : (
        <Alert variant="info">
          <AlertDescription>
            No processor connected yet. Payment links appear on invoices (and a Pay now button in
            the customer portal) once your shop connects its own account — your money goes directly
            to you.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect a processor</CardTitle>
          <CardDescription>
            Bring your own account: ShopOS never holds or moves your money. Wallets your processor
            supports (Apple Pay, Google Pay, Alipay, WeChat Pay, and more) ride along automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="grid gap-1 text-sm font-medium">
            Processor
            <select
              value={adapterKey}
              onChange={(e) => {
                setAdapterKey(e.target.value);
                setSecret({});
                setConfig({});
              }}
              className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a processor…</option>
              {adapters
                .filter((a) => a.status === "live")
                .map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.displayName}
                  </option>
                ))}
            </select>
          </label>

          {selected ? (
            <>
              <p className="text-sm text-muted-foreground">{selected.description}</p>
              <Input
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={pending}
              />
              {selected.configFields.map((field) => (
                <label key={field.name} className="grid gap-1 text-sm font-medium">
                  {field.label}
                  {field.required ? " *" : ""}
                  <Input
                    value={config[field.name] ?? ""}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                    placeholder={field.placeholder ?? ""}
                    disabled={pending}
                  />
                </label>
              ))}
              {selected.secretFields.map((field) => (
                <label key={field.name} className="grid gap-1 text-sm font-medium">
                  {field.label}
                  {field.required ? " *" : ""}
                  <Input
                    type={field.type === "password" ? "password" : "text"}
                    value={secret[field.name] ?? ""}
                    onChange={(e) =>
                      setSecret((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                    placeholder={field.placeholder ?? "Enter new value"}
                    disabled={pending}
                  />
                </label>
              ))}
              <Button type="submit" disabled={pending || !adapterKey}>
                {pending ? "Connecting…" : connector ? "Replace credentials" : "Connect processor"}
              </Button>
              <p className="text-xs text-muted-foreground">
                For automatic payment confirmation, add a webhook in your Stripe dashboard pointing
                at{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {window.location.origin}/api/webhooks/payments/{organizationId}/stripe
                </code>{" "}
                and store its signing secret (whsec_…) above.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
      {adapters.some((a) => a.status === "planned") ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">More processors on the way</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {adapters
              .filter((a) => a.status === "planned")
              .map((a) => (
                <span
                  key={a.key}
                  title={a.description}
                  className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground"
                >
                  {a.displayName}
                </span>
              ))}
            <p className="w-full pt-2 text-xs text-muted-foreground">
              Adapter slots are built into ShopOS — tell us which one your shop uses and it moves up
              the list.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </form>
  );
}
