"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Section navigation shared by every settings page. Active detection uses
 * the path segment after /settings/.
 */
export function SettingsNav({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const base = `/app/${orgId}/settings`;

  const items: ReadonlyArray<{ href: string; label: string; segment: string }> = [
    { href: `${base}/profile`, label: "Shop profile", segment: "profile" },
    { href: `${base}/work`, label: "Work preferences", segment: "work" },
    { href: `${base}/notifications`, label: "Notifications", segment: "notifications" },
    { href: `${base}/taxes`, label: "Taxes", segment: "taxes" },
    { href: `${base}/fees`, label: "Fees", segment: "fees" },
    { href: `${base}/disclaimers`, label: "Disclaimers", segment: "disclaimers" },
    { href: `${base}/hours`, label: "Business hours", segment: "hours" },
    { href: `${base}/email`, label: "Email delivery", segment: "email" },
  ];

  return (
    <nav aria-label="Settings" className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
