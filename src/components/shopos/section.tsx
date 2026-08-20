import type { ReactNode } from "react";

export type SectionNavItem = Readonly<{
  href: string;
  label: string;
}>;

export type SectionNavProps = Readonly<{
  items: readonly SectionNavItem[];
}>;

/**
 * Sticky in-page section navigation for long detail pages. Anchor links work
 * without JavaScript; the bar bleeds to the content padding edges and stays
 * pinned while the page scrolls, so tablet users jump instead of scrolling.
 */
export function SectionNav({ items }: SectionNavProps) {
  return (
    <nav
      aria-label="Sections"
      className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6"
    >
      <ul className="flex gap-2 overflow-x-auto">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export type PageSectionProps = Readonly<{
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}>;

/** A titled, anchorable section of a long page. Pairs with {@link SectionNav}. */
export function PageSection({ id, title, description, children }: PageSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-20 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
