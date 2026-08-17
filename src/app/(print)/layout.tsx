import type { ReactNode } from "react";

/**
 * Bare layout for print documents: no app shell, no theme chrome — just the
 * document. Pages opt into the PrintFrame letterhead.
 */
export default function PrintLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="min-h-svh bg-neutral-100">{children}</div>;
}
