"use client";

import { Building2, Users, Wrench, Package, ClipboardList } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Permission } from "@/modules/tenancy/policy";

export type NavItem = Readonly<{
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
  disabled?: boolean;
}>;

export type SidebarProps = Readonly<{
  organizationId: string;
  permissions: ReadonlySet<Permission>;
}>;

/**
 * Primary navigation for the authenticated shell. Items are permission-aware:
 * a nav entry appears only if the actor holds its required permission (or it has
 * no permission requirement). Future modules appear as disabled placeholders
 * rather than leaking protected content (AGENTS.md: "Lack of permission removes
 * or disables actions without changing canonical URLs or leaking protected
 * counts").
 */
export function Sidebar({ organizationId, permissions }: SidebarProps) {
  const pathname = usePathname();
  const baseHref = `/app/${organizationId}`;

  const sections: ReadonlyArray<Readonly<{ heading: string; items: readonly NavItem[] }>> = [
    {
      heading: "Organization",
      items: [
        { label: "Overview", href: baseHref, icon: Building2 },
        {
          label: "Members",
          href: `${baseHref}/members`,
          icon: Users,
          permission: "memberships.manage",
        },
      ],
    },
    {
      heading: "Operations",
      items: [
        {
          label: "Customers",
          href: `${baseHref}/customers`,
          icon: ClipboardList,
          permission: "customers.read",
        },
        {
          label: "Assets",
          href: `${baseHref}/assets`,
          icon: Wrench,
          permission: "assets.read",
          disabled: true,
        },
        {
          label: "Work orders",
          href: `${baseHref}/work-orders`,
          icon: Package,
          permission: "work_orders.read",
          disabled: true,
        },
      ],
    },
  ];

  return (
    <nav aria-label="Primary" className="flex flex-col gap-6 p-4">
      {sections.map((section) => {
        const visibleItems = section.items.filter(
          (item) => !item.permission || permissions.has(item.permission),
        );
        if (visibleItems.length === 0) return null;

        return (
          <div key={section.heading} className="flex flex-col gap-1">
            <h2 className="px-3 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {section.heading}
            </h2>
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.disabled ? "#" : item.href}
                  aria-disabled={item.disabled}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                    item.disabled && "pointer-events-none opacity-40",
                  )}
                  {...(item.disabled
                    ? { onClick: (e: React.MouseEvent<HTMLAnchorElement>) => e.preventDefault() }
                    : {})}
                >
                  <Icon className="size-4" />
                  {item.label}
                  {item.disabled ? (
                    <span className="ml-auto text-xs text-muted-foreground">Soon</span>
                  ) : null}
                </Link>
              );
            })}
            <Separator className="mt-2" />
          </div>
        );
      })}
    </nav>
  );
}
