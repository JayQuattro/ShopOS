"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

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
} | null;

const SMTP_PRESET_HOSTS: Record<string, { host: string; port: string }> = {
  gmail: { host: "smtp.gmail.com", port: "587" },
  outlook: { host: "smtp.office365.com", port: "587" },
  zoho: { host: "smtp.zoho.com", port: "587" },
  "zoho-zepto-smtp": { host: "smtp.zeptomail.com", port: "587" },
  "sendgrid-smtp": { host: "smtp.sendgrid.net", port: "587" },
  "mailgun-smtp": { host: "smtp.mailgun.org", port: "587" },
  "postmark-smtp": { host: "smtp.postmarkapp.com", port: "587" },
  "mailjet-smtp": { host: "in-v3.mailjet.com", port: "587" },
  "brevo-smtp": { host: "smtp-relay.brevo.com", port: "587" },
  smtp2go: { host: "mail.smtp2go.com", port: "587" },
  elastic: { host: "smtp.elasticemail.com", port: "2525" },
  smtpcom: { host: "send.smtp.com", port: "587" },
  "ses-smtp": { host: "email-smtp.us-east-1.amazonaws.com", port: "587" },
};

export function OrgEmailSettingsForm() {
  const params = useParams<{ organization: string }>();
  const orgId = params.organization;
  const apiBase = `/api/organizations/${orgId}/settings/email`;

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
  const [testTo, setTestTo] = useState("");
  const [testPending, setTestPending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(apiBase);
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
        } else if (res.status === 403) {
          setError("You don't have permission to manage organization settings.");
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [apiBase]);

  const activeAdapter = adapters.find((a) => a.key === selectedAdapter);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(apiBase, {
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
        throw new Error(
          body.error === "invalid_configuration"
            ? "Fill in the required fields."
            : body.error === "encryption_key_missing"
              ? "The server has no connector encryption key configured. Set CONNECTOR_ENCRYPTION_KEY and restart."
              : (body.error ?? "Failed to save"),
        );
      }
      setSuccess(
        "Email connector configured. Emails from your organization will now use this provider.",
      );
      setSecret({});
      const refreshRes = await fetch(apiBase);
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

  async function handleDelete() {
    if (!confirm("Remove your organization's email connector? The platform default will be used."))
      return;
    setPending(true);
    try {
      const res = await fetch(apiBase, { method: "DELETE" });
      if (res.ok) {
        setConnector(null);
        setSelectedAdapter("");
        setConfig({});
        setSecret({});
        setSuccess("Email connector removed. Platform default will be used.");
      }
    } finally {
      setPending(false);
    }
  }

  async function sendTestEmail() {
    if (!testTo.trim()) return;
    setTestPending(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await fetch(`${apiBase}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const messages: Record<string, string> = {
          invalid_recipient: "Enter a valid email address.",
          email_not_configured:
            "No email provider is configured yet — save a connector (or ask your platform operator to) and try again.",
          send_failed:
            "The provider rejected the send. Check the credentials and that the sender address is verified with the provider.",
          permission_denied: "You don't have permission to manage organization settings.",
        };
        const friendly = messages[body.error ?? ""] ?? "Could not send the test email.";
        throw new Error(
          typeof body.detail === "string" && body.detail ? `${friendly}\n${body.detail}` : friendly,
        );
      }
      const via =
        body.adapterKey === "console" ? "the dev console (no real email sent)" : body.adapterKey;
      setTestResult(`Test email sent to ${testTo.trim()} via ${via}.`);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "Could not send the test email.");
    } finally {
      setTestPending(false);
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
            <CardTitle className="text-base">Your organization&apos;s email connector</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4">
            <span className="font-medium">{connector.displayName}</span>
            <Badge variant="outline">{connector.adapterKey}</Badge>
            <Badge variant={connector.status === "active" ? "default" : "secondary"}>
              {connector.status}
            </Badge>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={pending}
            >
              Remove
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Alert variant="info">
          <AlertDescription>
            No organization email connector configured. The platform default is being used.
            Configure your own to send emails from your domain.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send a test email</CardTitle>
          <CardDescription>
            Sends one real message through the provider this organization&apos;s email currently
            resolves to — your connector, or the platform default if you haven&apos;t set one.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium sm:max-w-md">
            Deliver to
            <Input
              type="email"
              value={testTo}
              onChange={(e) => {
                setTestTo(e.target.value);
                setTestResult(null);
                setTestError(null);
              }}
              placeholder="you@yourshop.com"
              disabled={testPending}
            />
          </label>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void sendTestEmail()}
              disabled={testPending || !testTo.trim()}
            >
              {testPending ? "Sending…" : "Send test email"}
            </Button>
          </div>
          {testResult ? <p className="text-sm text-muted-foreground">{testResult}</p> : null}
          {testError ? (
            <p className="text-sm text-destructive whitespace-pre-line">{testError}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configure organization email</CardTitle>
          <CardDescription>
            Transactional emails (work order updates, invoices, notifications) will be sent through
            this provider from your organization&apos;s domain.
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
                aria-label="Display name"
                placeholder="Display name"
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
                            if (field.name === "preset" && selectedAdapter === "smtp") {
                              const preset = SMTP_PRESET_HOSTS[value];
                              if (preset) {
                                next.host = preset.host;
                                next.port = preset.port;
                              }
                            }
                            return next;
                          });
                        }}
                        className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
                        disabled={pending}
                      >
                        <option value="">Select…</option>
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
