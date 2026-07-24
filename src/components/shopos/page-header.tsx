import type { ReactNode } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type Crumb = Readonly<{
  label: string;
  href?: string;
}>;

export type PageHeaderProps = Readonly<{
  title: string;
  description?: string;
  breadcrumbs?: readonly Crumb[];
  actions?: ReactNode;
}>;

/**
 * Record-level page header. Displays breadcrumbs, the record/page title, an
 * optional description, and a slot for the primary action (children). This is
 * the `RecordHeader` composition from the UI/UX design plan.
 */
export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <span key={`${crumb.label}-${index}`} className="contents">
                  <BreadcrumbItem>
                    {crumb.href && !isLast ? (
                      <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {!isLast ? <BreadcrumbSeparator /> : null}
                </span>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
