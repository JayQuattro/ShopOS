"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type ContactEntry = {
  name: string;
  role: string;
  email: string;
  phone: string;
  isPrimary: boolean;
};

type AddressEntry = {
  label: string;
  line1: string;
  line2: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  isPrimary: boolean;
};

export function CustomerCreateForm({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);

  // Customer fields
  const [kind, setKind] = useState("INDIVIDUAL");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");

  // Contact fields (inline)
  const [contact, setContact] = useState<ContactEntry>({
    name: "",
    role: "",
    email: "",
    phone: "",
    isPrimary: true,
  });

  // Address fields (inline)
  const [address, setAddress] = useState<AddressEntry>({
    label: "",
    line1: "",
    line2: "",
    city: "",
    stateProvince: "",
    postalCode: "",
    isPrimary: true,
  });

  const [includeContact, setIncludeContact] = useState(false);
  const [includeAddress, setIncludeAddress] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    setPending(true);
    setError(null);
    try {
      // 1. Create the customer
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          displayName,
          ...(email ? { primaryEmail: email } : {}),
          ...(phone ? { primaryPhone: phone } : {}),
          ...(reference ? { organizationReference: reference } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create customer.");
      }
      const data = await res.json();
      const customerId = data.customer.id;

      // 2. Add contact if provided
      if (includeContact && contact.name.trim()) {
        await fetch(`/api/customers/${customerId}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: contact.name,
            ...(contact.role ? { role: contact.role } : {}),
            ...(contact.email ? { email: contact.email } : {}),
            ...(contact.phone ? { phone: contact.phone } : {}),
            isPrimary: contact.isPrimary,
          }),
        });
      }

      // 3. Add address if provided
      if (includeAddress && address.label.trim() && address.line1.trim() && address.city.trim()) {
        await fetch(`/api/customers/${customerId}/addresses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: address.label,
            line1: address.line1,
            city: address.city,
            ...(address.line2 ? { line2: address.line2 } : {}),
            ...(address.stateProvince ? { stateProvince: address.stateProvince } : {}),
            ...(address.postalCode ? { postalCode: address.postalCode } : {}),
            isPrimary: address.isPrimary,
          }),
        }).catch(() => undefined);
      }

      setOpen(false);
      resetForm();
      if (onCreated) {
        onCreated();
      } else {
        window.location.reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function resetForm() {
    setKind("INDIVIDUAL");
    setDisplayName("");
    setEmail("");
    setPhone("");
    setReference("");
    setContact({ name: "", role: "", email: "", phone: "", isPrimary: true });
    setAddress({
      label: "",
      line1: "",
      line2: "",
      city: "",
      stateProvince: "",
      postalCode: "",
      isPrimary: true,
    });
    setIncludeContact(false);
    setIncludeAddress(false);
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Add customer</Button>;
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-xl gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Customer section */}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">Customer details</h3>
        <select
          value={kind}
          aria-label="Customer type"
          onChange={(e) => setKind(e.target.value)}
          className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="INDIVIDUAL">Individual</option>
          <option value="BUSINESS">Business</option>
        </select>
        <Input
          aria-label="Name *"
          placeholder="Name *"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={pending}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            aria-label="Email"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
          />
          <Input
            aria-label="Phone"
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={pending}
          />
        </div>
        <Input
          aria-label="Reference"
          placeholder="Reference (e.g. C-1001)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          disabled={pending}
        />
      </div>

      {/* Contact section (optional, inline) */}
      <Separator />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={includeContact}
          onChange={(e) => setIncludeContact(e.target.checked)}
        />
        Add a contact
      </label>
      {includeContact ? (
        <div className="grid gap-3 rounded-md border border-border p-3">
          <Input
            placeholder="Contact name *"
            value={contact.name}
            onChange={(e) => setContact({ ...contact, name: e.target.value })}
            disabled={pending}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              aria-label="Role / title"
              placeholder="Role / title"
              value={contact.role}
              onChange={(e) => setContact({ ...contact, role: e.target.value })}
              disabled={pending}
            />
            <Input
              aria-label="Phone"
              placeholder="Phone"
              value={contact.phone}
              onChange={(e) => setContact({ ...contact, phone: e.target.value })}
              disabled={pending}
            />
          </div>
          <Input
            aria-label="Email"
            placeholder="Email"
            type="email"
            value={contact.email}
            onChange={(e) => setContact({ ...contact, email: e.target.value })}
            disabled={pending}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={contact.isPrimary}
              onChange={(e) => setContact({ ...contact, isPrimary: e.target.checked })}
            />
            Primary contact
          </label>
        </div>
      ) : null}

      {/* Address section (optional, inline) */}
      <Separator />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={includeAddress}
          onChange={(e) => setIncludeAddress(e.target.checked)}
        />
        Add an address
      </label>
      {includeAddress ? (
        <div className="grid gap-3 rounded-md border border-border p-3">
          <Input
            placeholder="Label (e.g. Billing, Shop) *"
            value={address.label}
            onChange={(e) => setAddress({ ...address, label: e.target.value })}
            disabled={pending}
          />
          <Input
            aria-label="Address line 1 *"
            placeholder="Address line 1 *"
            value={address.line1}
            onChange={(e) => setAddress({ ...address, line1: e.target.value })}
            disabled={pending}
          />
          <Input
            aria-label="Address line 2"
            placeholder="Address line 2"
            value={address.line2}
            onChange={(e) => setAddress({ ...address, line2: e.target.value })}
            disabled={pending}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              aria-label="City *"
              placeholder="City *"
              value={address.city}
              onChange={(e) => setAddress({ ...address, city: e.target.value })}
              disabled={pending}
            />
            <Input
              aria-label="State"
              placeholder="State"
              value={address.stateProvince}
              onChange={(e) => setAddress({ ...address, stateProvince: e.target.value })}
              disabled={pending}
            />
            <Input
              aria-label="Postal code"
              placeholder="Postal code"
              value={address.postalCode}
              onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
              disabled={pending}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={address.isPrimary}
              onChange={(e) => setAddress({ ...address, isPrimary: e.target.checked })}
            />
            Primary address
          </label>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !displayName.trim()}>
          Create customer
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setOpen(false);
            resetForm();
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
