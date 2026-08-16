"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ConfigField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  options?: Array<{
    value: string;
    label: string;
    endpoint?: string;
    regionHint?: string;
    regionDefault?: string;
    forcePathStyle?: boolean;
    note?: string;
  }>;
};

type AdapterDefinition = {
  key: string;
  displayName: string;
  description: string;
  configFields: ConfigField[];
  secretFields: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
  }>;
};

type Connector = {
  id: string;
  adapterKey: string;
  displayName: string;
  configuration: Record<string, unknown>;
  hasSecret: boolean;
  status: string;
} | null;

export function StorageSettingsForm() {
  const [adapters, setAdapters] = useState<AdapterDefinition[]>([]);
  const [connector, setConnector] = useState<Connector>(null);
  const [selectedAdapter, setSelectedAdapter] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/platform/settings/storage");
        if (res.ok) {
          const data = await res.json();
          setAdapters(data.adapters ?? []);
          setConnector(data.connector);
          if (data.connector) {
            setSelectedAdapter(data.connector.adapterKey);
            setDisplayName(data.connector.displayName);
            const configMap: Record<string, string> = {};
            for (const [k, v] of Object.entries(data.connector.configuration ?? {})) {
              configMap[k] = String(v ?? "");
            }
            setConfig(configMap);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const activeAdapter = adapters.find((a) => a.key === selectedAdapter);
  const presetField = activeAdapter?.configFields.find((f) => f.name === "preset");
  const activePreset = presetField?.options?.find((o) => o.value === config.preset);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      if (config.endpoint && /[<>]/.test(config.endpoint)) {
        throw new Error(
          "The endpoint still contains placeholder values. Replace <REGION> or <ACCOUNT_ID> with your provider's details.",
        );
      }
      const res = await fetch("/api/platform/settings/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapterKey: selectedAdapter,
          displayName: displayName || activeAdapter?.displayName || "Storage Connector",
          configuration: config,
          secret,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      setSuccess("Storage connector configured successfully.");
      setSecret({});
      const refreshRes = await fetch("/api/platform/settings/storage");
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setConnector(data.connector);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <form onSubmit={handleSave} className="grid gap-6">
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
            <CardTitle className="text-base">Current storage connector</CardTitle>
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
            No storage connector configured. File attachments are unavailable.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configure file storage</CardTitle>
          <CardDescription>
            File attachments (inspection photos, documents) are stored through this provider.
            Objects are automatically namespaced by organization for tenant isolation.
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
              {activeAdapter.configFields.map((field) => {
                if (field.type === "select" && field.options) {
                  return (
                    <div key={field.name} className="grid gap-1">
                      <label className="text-sm font-medium">
                        {field.label}
                        {field.required ? " *" : ""}
                      </label>
                      <select
                        value={config[field.name] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          const option = field.options?.find((o) => o.value === value);
                          setConfig((prev) => {
                            const next = { ...prev, [field.name]: value };
                            if (field.name === "preset" && option) {
                              if (option.endpoint !== undefined) next.endpoint = option.endpoint;
                              if (option.forcePathStyle !== undefined) {
                                next.forcePathStyle = String(option.forcePathStyle);
                              }
                              if (option.regionDefault !== undefined) {
                                next.region = option.regionDefault;
                              }
                            }
                            return next;
                          });
                        }}
                        className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
                        disabled={pending}
                      >
                        <option value="">{field.placeholder ?? "Select…"}</option>
                        {field.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {field.name === "preset" && activePreset?.note ? (
                        <p className="text-xs text-muted-foreground">{activePreset.note}</p>
                      ) : null}
                    </div>
                  );
                }

                if (field.type === "boolean") {
                  return (
                    <label key={field.name} className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={config[field.name] === "true"}
                        onChange={(e) =>
                          setConfig((prev) => ({ ...prev, [field.name]: String(e.target.checked) }))
                        }
                        disabled={pending}
                        className="size-4 rounded border-input"
                      />
                      {field.label}
                      {field.required ? " *" : ""}
                    </label>
                  );
                }

                const placeholder =
                  field.name === "region" && activePreset?.regionHint
                    ? activePreset.regionHint
                    : field.placeholder;
                return (
                  <label key={field.name} className="grid gap-1 text-sm font-medium">
                    {field.label}
                    {field.required ? " *" : ""}
                    <Input
                      type={field.type === "number" ? "number" : "text"}
                      value={config[field.name] ?? ""}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      placeholder={placeholder}
                      disabled={pending}
                    />
                  </label>
                );
              })}
              {activeAdapter.secretFields.length > 0 ? (
                <>
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
                        placeholder={field.placeholder ?? "Enter new value"}
                        disabled={pending}
                      />
                    </label>
                  ))}
                </>
              ) : null}
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
