import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/shopos/app-shell";
import { db } from "@/db/client";
import { resolveOrgIdentifier } from "@/modules/organizations/resolve-org-identifier";

/**
 * Authenticated application layout. Wraps every page under /app/<organization>/
 * in the responsive AppShell. The [organization] param accepts either a UUID or
 * a slug — if a slug is used, we redirect to the UUID-based URL for consistency
 * so all internal links (which use the resolved orgId) work correctly.
 */
export default async function AppLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ organization: string }> }>) {
  const { organization } = await params;

  // If it's not a UUID, resolve the slug and redirect to the canonical UUID URL.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    organization,
  );

  if (!isUuid) {
    const orgId = await resolveOrgIdentifier(db, organization);
    if (orgId) {
      redirect(`/app/${orgId}`);
    }
    // If the slug doesn't resolve, fall through to the shell which will show
    // a context mismatch error (the resolved context won't match).
  }

  return <AppShell>{children}</AppShell>;
}
