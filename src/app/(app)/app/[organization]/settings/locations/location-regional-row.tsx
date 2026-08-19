"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type LocationRegional = {
  id: string;
  name: string;
  code: string;
  timeZone: string;
  currency: string | null;
  locale: string | null;
  invoiceNumberPrefix: string | null;
};

/** One location: identity plus currency/locale overrides with live effect. */
export function LocationRegionalRow({
  organizationId,
  location,
  effectiveCurrency,
  effectiveLocale,
}: {
  organizationId: string;
  location: LocationRegional;
  effectiveCurrency: string;
  effectiveLocale: string;
}) {
  const [currency, setCurrency] = useState(location.currency ?? "");
  const [locale, setLocale] = useState(location.locale ?? "");
  const [invoicePrefix, setInvoicePrefix] = useState(location.invoiceNumberPrefix ?? "");
  const [effective, setEffective] = useState({
    currency: effectiveCurrency,
    locale: effectiveLocale,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    currency !== (location.currency ?? "") ||
    locale !== (location.locale ?? "") ||
    invoicePrefix !== (location.invoiceNumberPrefix ?? "");

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(
        `/api/organizations/${organizationId}/locations/${location.id}/regional`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currency: currency || null,
            locale: locale || null,
            invoiceNumberPrefix: invoicePrefix || null,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          invalid_currency: "Currency is a 3-letter code, like CAD or EUR.",
          invalid_locale: "Locale looks like en-US, pt-BR, or fr-CA.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Could not save.");
      }
      setEffective(await res.json());
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {location.name}
          <Badge variant="outline" className="text-[10px]">
            {location.code}
          </Badge>
          <span className="text-xs font-normal text-muted-foreground">{location.timeZone}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium">
            Currency override
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              placeholder="inherit"
              disabled={pending}
              className="h-9 w-28 font-mono text-sm"
              aria-label={`Currency override for ${location.name}`}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Locale override
            <Input
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              placeholder="inherit"
              disabled={pending}
              className="h-9 w-36 font-mono text-sm"
              aria-label={`Locale override for ${location.name}`}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Invoice series prefix
            <Input
              value={invoicePrefix}
              onChange={(e) => setInvoicePrefix(e.target.value)}
              placeholder="inherit"
              disabled={pending}
              className="h-9 w-32 font-mono text-sm"
              aria-label={`Invoice series prefix for ${location.name}`}
            />
          </label>
          {dirty ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          ) : saved ? (
            <span className="text-xs text-muted-foreground">Saved</span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Effective at this location: <span className="font-mono">{effective.currency}</span> ·{" "}
          <span className="font-mono">{effective.locale}</span>
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
