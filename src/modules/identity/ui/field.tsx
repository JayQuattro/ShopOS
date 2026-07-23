import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal labeled field wrapper for auth forms. Uses a native <label> for
 * accessible association. When the full form primitive catalog lands, auth
 * forms will adopt it; until then this keeps markup consistent and avoids
 * feature-local field systems (AGENTS.md).
 */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
