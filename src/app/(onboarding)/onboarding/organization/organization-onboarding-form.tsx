"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const COMMON_CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "JPY", "MXN", "BRL", "INR", "CNY"];

const COMMON_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

export function OrganizationOnboardingForm() {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/onboarding/organization", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        organization: {
          name: form.get("organizationName"),
          slug: form.get("organizationSlug"),
          defaultCurrency: form.get("defaultCurrency"),
        },
        firstLocation: {
          name: form.get("locationName"),
          code: form.get("locationCode"),
          timeZone: form.get("timeZone"),
        },
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Your organization could not be created.");
      setSubmitting(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form className="grid gap-6" onSubmit={submit}>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Organization name" name="organizationName" placeholder="Atlas Service" />
        <Field label="Organization slug" name="organizationSlug" placeholder="atlas-service" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="First location" name="locationName" placeholder="Main Shop" />
        <Field label="Location code" name="locationCode" placeholder="MAIN" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="Currency"
          name="defaultCurrency"
          defaultValue="USD"
          options={COMMON_CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
        <SelectField
          label="Time zone"
          name="timeZone"
          defaultValue="America/New_York"
          options={COMMON_TIME_ZONES.map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }))}
        />
      </div>
      <Button disabled={submitting} type="submit">
        {submitting ? "Creating organization…" : "Create organization"}
      </Button>
    </form>
  );
}

function Field(props: {
  label: string;
  name: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {props.label}
      <Input
        required
        name={props.name}
        placeholder={props.placeholder}
        defaultValue={props.defaultValue}
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  name: string;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {props.label}
      <select
        required
        name={props.name}
        defaultValue={props.defaultValue}
        className="flex h-[var(--control-height)] w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
