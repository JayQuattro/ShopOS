"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Profile = {
  defaultPhoneCountry: string | null;
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  country: string | null;
  defaultCurrency: string;
  defaultLocale: string | null;
  taxId: string | null;
};

/** Shop identity + contact details. Empty fields clear; website needs http(s). */
export function ProfileForm({ initial }: { initial: Profile }) {
  const [profile, setProfile] = useState({
    name: initial.name,
    contactPhone: initial.contactPhone ?? "",
    contactEmail: initial.contactEmail ?? "",
    website: initial.website ?? "",
    addressLine1: initial.addressLine1 ?? "",
    addressLine2: initial.addressLine2 ?? "",
    city: initial.city ?? "",
    stateProvince: initial.stateProvince ?? "",
    postalCode: initial.postalCode ?? "",
    country: initial.country ?? "",
    defaultCurrency: initial.defaultCurrency ?? "USD",
    defaultLocale: initial.defaultLocale ?? "",
    taxId: initial.taxId ?? "",
    defaultPhoneCountry: initial.defaultPhoneCountry ?? "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function set<K extends keyof typeof profile>(key: K, value: string) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (profile.name.trim().length < 2) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const orgId = window.location.pathname.split("/")[2] ?? "";
      const payload: Record<string, unknown> = {
        ...profile,
        defaultPhoneCountry: (profile.defaultPhoneCountry ?? "").toUpperCase() || null,
        defaultLocale: profile.defaultLocale || null,
        country: profile.country || null,
      };
      const res = await fetch(`/api/organizations/${orgId}/settings/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          invalid_website: "The website must start with http:// or https://.",
          invalid_country: "Country is a two-letter code, e.g. US.",
          invalid_currency: "Currency is a 3-letter code, like USD or CAD.",
          invalid_locale: "Locale looks like en-US, pt-BR, or fr-CA.",
          invalid_tax_id: "Tax IDs are 4–32 letters, digits, dots, dashes, or slashes.",
          invalid_name: "Give the shop a name.",
        };
        throw new Error(messages[data.error] ?? "Could not save the profile.");
      }
      setSuccess("Profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const field = (
    key: keyof typeof profile,
    label: string,
    placeholder: string,
    extras?: { type?: string; className?: string },
  ) => (
    <label className={`grid gap-1 text-sm font-medium ${extras?.className ?? ""}`}>
      {label}
      <Input
        type={extras?.type ?? "text"}
        value={profile[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        disabled={pending}
      />
    </label>
  );

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
          <CardDescription>Shown to customers everywhere your shop appears.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {field("name", "Shop name", "Atlas Service Collective")}
          {field("website", "Website", "https://example.com")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact</CardTitle>
          <CardDescription>
            {
              "Customers see these on the repair tracker, printed documents, and message signatures."
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {field("contactPhone", "Phone", "(555) 010-0100")}
          {field("contactEmail", "Email", "shop@example.com", { type: "email" })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Address</CardTitle>
          <CardDescription>Appears on the letterhead of printed documents.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {field("addressLine1", "Street address", "123 Main St", { className: "sm:col-span-2" })}
          {field("addressLine2", "Suite / unit", "Bay 2", { className: "sm:col-span-2" })}
          {field("city", "City", "Raleigh")}
          {field("stateProvince", "State / province", "NC")}
          {field("postalCode", "Postal code", "27601")}
          {field("defaultCurrency", "Default currency (3-letter)", "USD")}
          {field("defaultLocale", "Default display locale (e.g. en-US, pt-BR — blank = en-US)", "")}
          {field(
            "taxId",
            "Tax registration ID (VAT, EIN, GSTIN, RFC, CNPJ — shown on invoices)",
            "",
          )}
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={pending || profile.name.trim().length < 2}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
