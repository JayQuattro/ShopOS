import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Standardized empty, loading, error, and permission-denied state components.
 *
 * These are the ShopOS domain compositions for consistent record/list feedback
 * states (AGENTS.md: "Design loading, empty, partial, degraded, permission-
 * denied, offline, and error states"). They use semantic tokens and provide
 * accessible, non-color-only messaging.
 */

export type EmptyStateProps = Readonly<{
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}>;

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export type LoadingStateProps = Readonly<{
  label?: string;
  className?: string;
}>;

export function LoadingState({ label = "Loading…", className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 px-6 py-8 text-sm text-muted-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      {label}
    </div>
  );
}

export type ErrorStateProps = Readonly<{
  title?: string;
  description: string;
  retry?: ReactNode;
}>;

export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
}: ErrorStateProps) {
  return (
    <div className="px-6 py-6">
      <Alert variant="destructive">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
      {retry ? <div className="mt-3">{retry}</div> : null}
    </div>
  );
}

export type PermissionDeniedStateProps = Readonly<{
  message?: string;
}>;

export function PermissionDeniedState({
  message = "You do not have permission to view this content.",
}: PermissionDeniedStateProps) {
  return (
    <div className="px-6 py-6">
      <Alert variant="warning">
        <AlertTitle>Permission denied</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}

/**
 * Wraps table content with a consistent scroll region, caption, and responsive
 * overflow behavior. The design-system page demonstrates the canonical table
 * styling; this composition standardizes it for all record lists.
 */
export type DataTableProps = Readonly<{
  children: ReactNode;
  caption?: string;
  className?: string;
}>;

export function DataTable({ children, caption, className }: DataTableProps) {
  return (
    <div
      className={cn(
        "overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        className,
      )}
      role="region"
      tabIndex={0}
    >
      <table className="w-full text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

/**
 * Standardized summary card for record-level key-value displays.
 */
export type SummaryCardProps = Readonly<{
  label: string;
  value: ReactNode;
  className?: string;
}>;

export function SummaryCard({ label, value, className }: SummaryCardProps) {
  return (
    <Card className={className}>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}
