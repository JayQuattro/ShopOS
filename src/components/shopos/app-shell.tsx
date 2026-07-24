import type { ReactNode } from "react";

import { ThemeSwitcher } from "@/components/shopos/theme/theme-switcher";
import { db } from "@/db/client";
import { resolveShellContext, type ShellLocation } from "@/modules/tenancy/shell-context";

import { CommandPalette, type CommandAction } from "./command-palette";
import { MobileSidebar } from "./mobile-sidebar";
import { OrgLocationSwitcher } from "./org-location-switcher";
import { Sidebar } from "./sidebar";
import { UserMenu } from "./user-menu";

export type AppShellProps = Readonly<{
  children: ReactNode;
}>;

/**
 * Authenticated application shell. Renders the responsive sidebar, header with
 * org/location switcher, command palette, user menu, and theme switcher. Resolves
 * the full shell context (authorization + display data) server-side; interactive
 * pieces (switcher, drawer, user menu) are client islands.
 */
export async function AppShell({ children }: AppShellProps) {
  const shell = await resolveShellContext(db);

  // Fetch other organizations the user belongs to (for the switcher).
  const otherMemberships = await db.organizationMembership.findMany({
    where: {
      userId: shell.tenant.actorId,
      active: true,
      organizationId: { not: shell.tenant.organizationId },
    },
    select: {
      organization: { select: { id: true, name: true } },
    },
  });
  const otherOrganizations = otherMemberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
  }));

  const commandActions: CommandAction[] = [
    { label: "Overview", href: `/app/${shell.organization.id}`, group: "Organization" },
    { label: "Members", href: `/app/${shell.organization.id}/members`, group: "Organization" },
    { label: "Account & security", href: "/security", group: "Account" },
    { label: "Sign out", href: "/sign-in", group: "Account" },
  ];

  return (
    <div className="flex min-h-svh bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        <div className="flex h-[var(--control-height)] items-center px-4">
          <span className="text-sm font-bold tracking-tight text-sidebar-foreground">ShopOS</span>
        </div>
        <Sidebar organizationId={shell.organization.id} permissions={shell.tenant.permissions} />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-[var(--control-height)] shrink-0 items-center gap-2 border-b border-border bg-card px-3">
          <MobileSidebar
            organizationId={shell.organization.id}
            permissions={shell.tenant.permissions}
          />
          <OrgLocationSwitcher
            organizationId={shell.organization.id}
            organizationName={shell.organization.name}
            locations={shell.locations satisfies readonly ShellLocation[]}
            otherOrganizations={otherOrganizations}
          />
          <div className="ml-auto flex items-center gap-2">
            <CommandPalette actions={commandActions} />
            <ThemeSwitcher compact />
            <UserMenu displayName={shell.user.displayName} email={shell.user.email} />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
