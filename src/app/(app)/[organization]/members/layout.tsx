import Link from "next/link";
import type { ReactNode } from "react";

import { getRequestContext } from "@/modules/tenancy/request-context";

/**
 * Minimal authenticated shell for the membership admin surface. The full
 * application shell (issue #51) is not yet built; this layout resolves the
 * tenant context and shows visible organization context per AGENTS.md.
 */
export default async function MembersAdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const context = await getRequestContext();

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground">Organization</span>
            <span className="text-base font-semibold tracking-tight">{context.organizationId}</span>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link
              href={`/app/${context.organizationId}/members`}
              className="text-foreground underline-offset-4 hover:underline"
            >
              Members
            </Link>
            <Link
              href={`/app/${context.organizationId}/members/invitations`}
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              Invitations
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
