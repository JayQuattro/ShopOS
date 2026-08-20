import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type RecordListProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

/**
 * Touch-first record list: divided rows sized for tablet use. Pair with
 * {@link RecordListRow} inside a borderless card. Each row is a single,
 * full-width tap target — never a small inline "View" link.
 */
export function RecordList({ children, className }: RecordListProps) {
  return <ul className={cn("divide-y divide-border", className)}>{children}</ul>;
}

export type RecordListRowProps = Readonly<{
  /** Destination when the row is tapped. Omit for informational (non-link) rows. */
  href?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Badges or metrics aligned to the trailing edge. */
  trailing?: ReactNode;
  /** Icon or avatar aligned to the leading edge. */
  leading?: ReactNode;
}>;

export function RecordListRow({ href, title, description, trailing, leading }: RecordListRowProps) {
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        {description ? (
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">{description}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{trailing}</span>
      ) : null}
    </>
  );

  if (!href) {
    return (
      <li>
        <div className="flex min-h-14 items-center gap-3 px-4 py-3">{body}</div>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={href}
        className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-muted"
      >
        {body}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/70" />
      </Link>
    </li>
  );
}
