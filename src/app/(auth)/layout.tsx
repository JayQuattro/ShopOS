import type { ReactNode } from "react";

import { authStrings } from "@/modules/identity/ui/strings";

/**
 * Centered auth shell. Deliberately omits the authenticated application chrome;
 * the proxy redirects unauthenticated `/app/*` traffic here.
 */
export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <header className="flex flex-col items-center gap-2 text-center">
        <span className="text-lg font-semibold tracking-tight">{authStrings.brand}</span>
      </header>
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}
