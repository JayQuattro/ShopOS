import type { ReactNode } from "react";

import { AppShell } from "@/components/shopos/app-shell";

/**
 * Authenticated application layout. Wraps every page under /app/<organization>/
 * in the responsive AppShell (sidebar, header, switchers, user menu).
 */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
