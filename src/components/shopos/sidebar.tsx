"use client";

import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  Car,
  ClipboardList,
  Coins,
  Contact,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  PhoneCall,
  Plus,
  Settings,
  SlidersHorizontal,
  Truck,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { Permission } from "@/modules/tenancy/policy";

export type NavItem = Readonly<{
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
}>;

export type SidebarProps = Readonly<{
  organizationId: string;
  permissions: ReadonlySet<Permission>;
}>;

/**
 * Primary navigation for the authenticated shell, organized by how a shop
 * actually works: start the day (board, schedule, jobs), deal with people
 * and their vehicles, move vehicles around, handle money, then manage the
 * shop. Every item has its own icon — recognition over reading. Items are
 * permission-aware: an entry appears only if the actor holds its permission
 * (AGENTS.md: lack of permission removes actions without leaking protected
 * content).
 */
export function Sidebar({ organizationId, permissions }: SidebarProps) {
  const pathname = usePathname();
  const baseHref = `/app/${organizationId}`;
  const canCreateWorkOrders = permissions.has("work_orders.write");

  const sections: ReadonlyArray<Readonly<{ heading: string; items: readonly NavItem[] }>> = [
    {
      heading: "Today",
      items: [
        {
          label: "Work board",
          href: `${baseHref}/board`,
          icon: LayoutDashboard,
          permission: "work_orders.read",
        },
        {
          label: "Schedule",
          href: `${baseHref}/schedule`,
          icon: CalendarDays,
          permission: "work_orders.read",
        },
        {
          label: "Work orders",
          href: `${baseHref}/work-orders`,
          icon: ClipboardList,
          permission: "work_orders.read",
        },
      ],
    },
    {
      heading: "Customers",
      items: [
        {
          label: "Customers",
          href: `${baseHref}/customers`,
          icon: Contact,
          permission: "customers.read",
        },
        { label: "Vehicles", href: `${baseHref}/assets`, icon: Wrench, permission: "assets.read" },
        {
          label: "Messages",
          href: `${baseHref}/messages`,
          icon: MessageSquare,
          permission: "customers.read",
        },
      ],
    },
    {
      heading: "On the move",
      items: [
        {
          label: "Roadside",
          href: `${baseHref}/roadside`,
          icon: Truck,
          permission: "work_orders.read",
        },
        {
          label: "Pickup & delivery",
          href: `${baseHref}/logistics`,
          icon: ArrowLeftRight,
          permission: "work_orders.read",
        },
        { label: "Keys", href: `${baseHref}/keys`, icon: KeyRound, permission: "work_orders.read" },
        { label: "Fleet", href: `${baseHref}/fleet`, icon: Car, permission: "assets.read" },
      ],
    },
    {
      heading: "Money",
      items: [
        {
          label: "Billing",
          href: `${baseHref}/billing`,
          icon: Wallet,
          permission: "customers.read",
        },
        {
          label: "Cash drawer",
          href: `${baseHref}/cash-drawer`,
          icon: Coins,
          permission: "payments.record",
        },
      ],
    },
    {
      heading: "Manage",
      items: [
        {
          label: "Inventory",
          href: `${baseHref}/inventory`,
          icon: Boxes,
          permission: "work_orders.read",
        },
        {
          label: "Service menu",
          href: `${baseHref}/service-menu`,
          icon: ListChecks,
          permission: "work_orders.read",
        },
        {
          label: "Declined work",
          href: `${baseHref}/declined-work`,
          icon: PhoneCall,
          permission: "work_orders.read",
        },
        {
          label: "Reports",
          href: `${baseHref}/reports`,
          icon: BarChart3,
          permission: "work_orders.read",
        },
      ],
    },
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
      heading: "Settings",
      items: [
        {
          label: "Email",
          href: `${baseHref}/settings/email`,
          icon: Settings,
          permission: "organizations.manage",
        },
        {
          label: "Work preferences",
          href: `${baseHref}/settings/work`,
          icon: SlidersHorizontal,
          permission: "organizations.manage",
        },
      ],
    },
  ];

  return (
    <nav aria-label="Primary" className="flex flex-col gap-5 p-4">
      {canCreateWorkOrders ? (
        <Link
          href={`${baseHref}/work-orders?new=1`}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" />
          New work order
        </Link>
      ) : null}

      {sections.map((section) => {
        const visibleItems = section.items.filter(
          (item) => !item.permission || permissions.has(item.permission),
        );
        if (visibleItems.length === 0) return null;

        return (
          <div key={section.heading} className="flex flex-col gap-0.5">
            <h2 className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {section.heading}
            </h2>
            {visibleItems.map((item) => {
              const Icon = item.icon;
              // Overview (the base href) should only be active on an exact match.
              // Other items are active on exact match or when the path is a child.
              const isBase = item.href === baseHref;
              const active = isBase
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                  )}
                >
                  <Icon
                    className={cn("size-4", active ? "text-primary" : "text-muted-foreground")}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
