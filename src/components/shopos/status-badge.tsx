import { CircleCheck, CircleDot, Clock3, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const statusStyles = {
  ready:
    "border-success/30 bg-status-success-background text-status-success-foreground [&>svg]:text-success",
  waiting:
    "border-warning/35 bg-status-warning-background text-status-warning-foreground [&>svg]:text-warning",
  attention:
    "border-destructive/30 bg-status-destructive-background text-status-destructive-foreground [&>svg]:text-destructive",
  neutral:
    "border-border bg-status-neutral-background text-status-neutral-foreground [&>svg]:text-muted-foreground",
} as const;

const statusIcons = {
  ready: CircleCheck,
  waiting: Clock3,
  attention: TriangleAlert,
  neutral: CircleDot,
} as const;

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: keyof typeof statusStyles;
  children: ReactNode;
  className?: string;
}) {
  const Icon = statusIcons[tone];

  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold",
        statusStyles[tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}
