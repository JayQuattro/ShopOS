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
  configFields: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
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
  lastHealthCheckAt: string | null;
} | null;

export function EmailSettingsForm() {
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
        const res = await fetch("/api/platform/settings/email");
        if (res.ok) {
          const data = await res.json();
          setAdapters(data.adapters ?? []);
          setConnector(data.connector);
          if (data.connector) {
            setSelectedAdapter(data.connector.adapterKey);
            setDisplayName(data.connector.displayName);
            // Populate config values (not secrets — they're write-only).
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/platform/settings/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapterKey: selectedAdapter,
          displayName: displayName || activeAdapter?.displayName || "Email Connector",
          configuration: config,
          secret,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      setSuccess("Email connector configured successfully.");
      setSecret({});
      // Reload.
      const refreshRes = await fetch("/api/platform/settings/email");
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

  async function handleTest() {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/platform/settings/email/test", { method: "POST" });
      const body = await res.json();
      if (body.success) {
        setSuccess(body.detail);
      } else {
        setError(body.detail ?? "Test failed.");
      }
    } catch {
      setError("Could not test the connector.");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

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
            <CardTitle className="text-base">Current connector</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4">
            <span className="font-medium">{connector.displayName}</span>
            <Badge variant="outline">{connector.adapterKey}</Badge>
            <Badge variant={connector.status === "active" ? "default" : "secondary"}>
              {connector.status}
            </Badge>
            {connector.hasSecret ? <Badge variant="secondary">credentials set</Badge> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={pending}
            >
              Test connection
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Alert variant="warning">
          <AlertDescription>
            No email connector configured. Auth emails will not be delivered.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configure email delivery</CardTitle>
          <CardDescription>
            All authentication emails (verification, password reset, magic links, OTPs) will be sent
            through this provider.
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
                placeholder="Display name (e.g. 'ShopOS Email')"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={pending}
              />

              <h4 className="text-sm font-semibold">Connection settings</h4>
              {activeAdapter.configFields.map((field) => {
                if (field.type === "select" && field.options) {
                  return (
                    <label key={field.name} className="grid gap-1 text-sm font-medium">
                      {field.label}
                      <select
                        value={config[field.name] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setConfig((prev) => {
                            const next = { ...prev, [field.name]: value };
                            // SMTP preset: auto-fill host/port/secure.
                            if (field.name === "preset" && selectedAdapter === "smtp") {
                              const presetMap: Record<
                                string,
                                { host: string; port: string; secure: boolean }
                              > = {
                                gmail: { host: "smtp.gmail.com", port: "587", secure: false },
                                outlook: { host: "smtp.office365.com", port: "587", secure: false },
                                zoho: { host: "smtp.zoho.com", port: "587", secure: false },
                                "sendgrid-smtp": {
                                  host: "smtp.sendgrid.net",
                                  port: "587",
                                  secure: false,
                                },
                                "mailgun-smtp": {
                                  host: "smtp.mailgun.org",
                                  port: "587",
                                  secure: false,
                                },
                                "postmark-smtp": {
                                  host: "smtp.postmarkapp.com",
                                  port: "587",
                                  secure: false,
                                },
                                "mailjet-smtp": {
                                  host: "in-v3.mailjet.com",
                                  port: "587",
                                  secure: false,
                                },
                                "brevo-smtp": {
                                  host: "smtp-relay.brevo.com",
                                  port: "587",
                                  secure: false,
                                },
                                smtp2go: { host: "mail.smtp2go.com", port: "587", secure: false },
                                elastic: {
                                  host: "smtp.elasticemail.com",
                                  port: "2525",
                                  secure: false,
                                },
                                smtpcom: { host: "send.smtp.com", port: "587", secure: false },
                                "ses-smtp": {
                                  host: "email-smtp.us-east-1.amazonaws.com",
                                  port: "587",
                                  secure: false,
                                },
                              };
                              const preset = presetMap[value];
                              if (preset) {
                                next.host = preset.host;
                                next.port = preset.port;
                                next.secure = String(preset.secure);
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
                    </label>
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
                      />
                      {field.label}
                    </label>
                  );
                }

                return (
                  <label key={field.name} className="grid gap-1 text-sm font-medium">
                    {field.label}
                    {field.required ? " *" : ""}
                    <Input
                      type={
                        field.type === "number"
                          ? "number"
                          : field.type === "email"
                            ? "email"
                            : "text"
                      }
                      value={config[field.name] ?? ""}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      disabled={pending}
                    />
                  </label>
                );
              })}

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
