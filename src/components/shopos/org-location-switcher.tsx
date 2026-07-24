"use client";

import { Building2, Check, ChevronDown, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/modules/identity/client/auth-client";
import type { ShellLocation } from "@/modules/tenancy/shell-context";

export type OrgLocationSwitcherProps = Readonly<{
  organizationId: string;
  organizationName: string;
  locations: readonly ShellLocation[];
  selectedLocationId?: string;
  otherOrganizations: readonly Readonly<{ id: string; name: string }>[];
}>;

/**
 * Organization and location context switcher. Always visible in the shell header
 * so the actor can never lose track of their current tenant scope before
 * committing sensitive work (AGENTS.md).
 *
 * Organization switching calls Better Auth's `organization.setActive`, which
 * updates the session's `activeOrganizationId` selection hint. The server
 * revalidates it on the next request via `resolveTenantContext`.
 */
export function OrgLocationSwitcher({
  organizationId,
  organizationName,
  locations,
  selectedLocationId,
  otherOrganizations,
}: OrgLocationSwitcherProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function switchOrganization(targetOrgId: string) {
    if (targetOrgId === organizationId) return;
    setPending(true);
    try {
      await authClient.organization.setActive({ organizationId: targetOrgId });
      router.push(`/app/${targetOrgId}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function switchLocation(locationId: string) {
    if (locationId === selectedLocationId) return;
    // Location selection is a query parameter the request context can read.
    const url = new URL(window.location.href);
    if (locationId) {
      url.searchParams.set("location", locationId);
    } else {
      url.searchParams.delete("location");
    }
    router.replace(`${url.pathname}?${url.searchParams.toString()}`);
    router.refresh();
  }

  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} className="gap-2">
          <Building2 className="size-4" />
          <span className="max-w-[12rem] truncate">{organizationName}</span>
          {selectedLocation ? (
            <>
              <span className="text-muted-foreground">·</span>
              <MapPin className="size-3.5" />
              <span className="max-w-[8rem] truncate">{selectedLocation.code}</span>
            </>
          ) : null}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[16rem]">
        <DropdownMenuLabel>Organization</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => switchOrganization(organizationId)}>
          <Building2 className="size-4" />
          <span className="flex-1 truncate">{organizationName}</span>
          <Check className="size-4" />
        </DropdownMenuItem>
        {otherOrganizations.map((org) => (
          <DropdownMenuItem key={org.id} onClick={() => switchOrganization(org.id)}>
            <Building2 className="size-4 opacity-0" />
            <span className="flex-1 truncate">{org.name}</span>
          </DropdownMenuItem>
        ))}

        {locations.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Location</DropdownMenuLabel>
            {locations.map((loc) => (
              <DropdownMenuItem key={loc.id} onClick={() => switchLocation(loc.id)}>
                <MapPin className="size-4" />
                <span className="flex-1 truncate">
                  {loc.name} ({loc.code})
                </span>
                {loc.id === selectedLocationId ? <Check className="size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
