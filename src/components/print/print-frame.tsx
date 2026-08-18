import type { ReactNode } from "react";

import type { PaperSizeValue } from "@/modules/organizations/paper-size";

/**
 * The skeleton of every printed document: shop letterhead, a document title,
 * and consistent print typography. Pages render black-on-white, sized for
 * letter paper, with the print button overlay excluded via print:hidden.
 */
/** CSS @page size and on-screen width per paper size. */
const PAPER_CSS: Readonly<
  Record<PaperSizeValue, { page: string; width: string; padding: string }>
> = {
  LETTER: { page: "letter", width: "max-w-[8.5in]", padding: "px-[0.75in]" },
  A4: { page: "A4", width: "max-w-[210mm]", padding: "px-[18mm]" },
  LEGAL: { page: "legal", width: "max-w-[8.5in]", padding: "px-[0.75in]" },
};

export function PrintFrame({
  organizationName,
  locationName,
  contactLine,
  title,
  subtitle,
  paper = "LETTER",
  children,
}: Readonly<{
  organizationName: string;
  locationName?: string | null;
  /** Shop contact/address line rendered under the letterhead name. */
  contactLine?: string | null;
  title: string;
  subtitle?: string;
  paper?: PaperSizeValue;
  children: ReactNode;
}>) {
  const css = PAPER_CSS[paper];
  return (
    <div className="min-h-svh bg-neutral-100 text-neutral-900 print:bg-white">
      {/* Server-rendered stylesheet: sets the printed page size. */}
      <style dangerouslySetInnerHTML={{ __html: `@page { size: ${css.page}; margin: 0.5in; }` }} />
      <div
        className={`mx-auto ${css.width} ${css.padding} bg-white py-10 shadow-sm print:shadow-none`}
      >
        <header className="border-b-2 border-neutral-900 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xl font-bold tracking-tight">{organizationName}</p>
              {locationName ? <p className="text-sm text-neutral-600">{locationName}</p> : null}
              {contactLine ? (
                <p className="mt-0.5 text-xs text-neutral-500">{contactLine}</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold uppercase tracking-wide">{title}</p>
              {subtitle ? <p className="text-sm text-neutral-600">{subtitle}</p> : null}
              <p className="text-xs text-neutral-500" suppressHydrationWarning>
                Printed {new Date().toLocaleDateString("en-US", { timeZone: "UTC" })}
              </p>
            </div>
          </div>
        </header>
        <main className="pt-6 text-[13px] leading-relaxed">{children}</main>
      </div>
    </div>
  );
}

export function PrintSection({
  heading,
  children,
}: Readonly<{ heading: string; children: ReactNode }>) {
  return (
    <section className="mb-5 break-inside-avoid">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">
        {heading}
      </h2>
      {children}
    </section>
  );
}

export function PrintKV({ items }: Readonly<{ items: ReadonlyArray<readonly [string, string]> }>) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
      {items.map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <dt className="w-32 shrink-0 text-neutral-500">{key}</dt>
          <dd className="font-medium">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
