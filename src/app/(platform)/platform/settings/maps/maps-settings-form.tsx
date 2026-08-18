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

/** Platform maps provider: one active adapter for geocoding + routing. */
export function MapsSettingsForm() {
  const [adapters, setAdapters] = useState<AdapterDefinition[]>([]);
  const [connector, setConnector] = useState<Connector>(null);
  const [selectedAdapter, setSelectedAdapter] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/platform/settings/maps");
          if (res.ok && !cancelled) {
            const data = await res.json();
            setAdapters(data.adapters ?? []);
            setConnector(data.connector ?? null);
            if (data.connector) {
              setSelectedAdapter(data.connector.adapterKey);
              setDisplayName(data.connector.displayName);
            }
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const activeAdapter = adapters.find((a) => a.key === selectedAdapter);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAdapter) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/platform/settings/maps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapterKey: selectedAdapter,
          displayName: displayName || activeAdapter?.displayName || "Maps Connector",
          configuration: config,
          secret,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error === "invalid_configuration"
            ? "Fill in the required fields."
            : "Failed to save.",
        );
      }
      setSuccess("Maps connector configured.");
      setSecret({});
      const refreshRes = await fetch("/api/platform/settings/maps");
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setConnector(data.connector ?? null);
      }
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
            <CardTitle className="text-base">Current maps connector</CardTitle>
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
        <Alert variant="warning">
          <AlertDescription>
            No maps connector configured. Service calls work without one; geocoding and ETAs are
            added automatically once a provider is set.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configure maps provider</CardTitle>
          <CardDescription>
            Geocoding resolves service-call addresses to coordinates; routing estimates drive time
            and distance from the shop to the customer.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="grid gap-1 text-sm font-medium">
            Provider
            <select
              value={selectedAdapter}
              onChange={(e) => {
                setSelectedAdapter(e.target.value);
                setConfig({});
                setSecret({});
              }}
              className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a provider…</option>
              {adapters.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>

          {activeAdapter ? (
            <>
              <p className="text-sm text-muted-foreground">{activeAdapter.description}</p>
              <Input
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={pending}
              />
              <h4 className="text-sm font-semibold">Connection settings</h4>
              {activeAdapter.configFields.map((field) => (
                <label key={field.name} className="grid gap-1 text-sm font-medium">
                  {field.label}
                  {field.required ? " *" : ""}
                  <Input
                    type="text"
                    value={config[field.name] ?? ""}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                    placeholder={field.placeholder}
                    disabled={pending}
                  />
                </label>
              ))}
              <h4 className="text-sm font-semibold">Credentials (write-only)</h4>
              {activeAdapter.secretFields.map((field) => (
                <label key={field.name} className="grid gap-1 text-sm font-medium">
                  {field.label}
                  {field.required ? " *" : ""}
                  <Input
                    type={field.type === "password" ? "password" : "text"}
                    value={secret[field.name] ?? ""}
                    onChange={(e) =>
                      setSecret((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                    placeholder="Enter new value"
                    disabled={pending}
                  />
                </label>
              ))}
              <Button type="submit" disabled={pending || !selectedAdapter}>
                {pending ? "Saving…" : "Save configuration"}
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </form>
  );
}
