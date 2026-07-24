import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PlatformContextNotResolved } from "@/modules/platform/authorization";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  let context;
  try {
    context = await getPlatformRequestContext();
  } catch (error) {
    if (error instanceof PlatformContextNotResolved) {
      notFound();
    }
    throw error;
  }

  const canManageOperators = context.permissions.has("platform.operators.manage");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link href="/platform" className="font-semibold tracking-tight">
              ShopOS Platform
            </Link>
            <nav aria-label="Platform administration" className="flex items-center gap-4">
              <Link
                className="text-sm text-muted-foreground hover:text-foreground"
                href="/platform"
              >
                Organizations
              </Link>
              {canManageOperators ? (
                <Link
                  className="text-sm text-muted-foreground hover:text-foreground"
                  href="/platform/operators"
                >
                  Operators
                </Link>
              ) : null}
            </nav>
          </div>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium">
            Control plane
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
    </div>
  );
}
