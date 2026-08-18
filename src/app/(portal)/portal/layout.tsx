import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentSession } from "@/modules/identity/session";
import { PortalSignOut } from "./portal-sign-out";

/**
 * Customer portal shell. Authentication is the same Better Auth session as
 * staff, but portal pages never resolve a TenantContext — the viewer's
 * authority comes from the server-side customer link, not membership.
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/sign-in?redirect=/portal");
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/portal" className="font-semibold tracking-tight">
            Customer portal
          </Link>
          <PortalSignOut />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
