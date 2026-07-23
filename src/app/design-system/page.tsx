import type { Metadata } from "next";
import { ArrowLeft, CheckCircle2, CircleAlert, Clock3, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/shopos/status-badge";
import { ThemePresetGrid } from "@/components/shopos/theme/theme-preset-grid";
import { ThemeSwitcher } from "@/components/shopos/theme/theme-switcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Design system",
  description: "The working ShopOS component and theme foundation.",
};

const sampleRows = [
  {
    order: "WO-1048",
    customer: "Maya Chen",
    asset: "2019 Subaru Outback",
    status: "Awaiting approval",
    tone: "waiting",
    total: "$1,284.32",
  },
  {
    order: "WO-1047",
    customer: "Holloway Electric",
    asset: "2022 Ford Transit",
    status: "In progress",
    tone: "neutral",
    total: "$642.00",
  },
  {
    order: "WO-1046",
    customer: "Jordan Williams",
    asset: "2017 Honda Accord",
    status: "Ready",
    tone: "ready",
    total: "$418.76",
  },
] as const;

export default function DesignSystemPage() {
  return (
    <div className="min-h-svh bg-background">
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-24 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-20 border-b border-border bg-background/92 backdrop-blur">
        <div className="mx-auto flex min-h-20 w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon">
              <Link href="/" aria-label="Back to ShopOS foundation">
                <ArrowLeft aria-hidden="true" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight">ShopOS design system</h1>
                <Badge variant="secondary">Preview</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Semantic tokens · source-owned components
              </p>
            </div>
          </div>
          <ThemeSwitcher />
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <section aria-labelledby="themes-heading">
          <div className="mb-6 max-w-3xl">
            <p className="mb-2 text-xs font-bold tracking-[0.14em] text-link uppercase">
              Appearance
            </p>
            <h2
              id="themes-heading"
              className="text-4xl font-semibold tracking-[-0.035em] sm:text-5xl"
            >
              Clean by default. Flexible by design.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Presets change semantic tokens—not component rules. Organization branding will layer
              onto this protected foundation after tenancy is implemented.
            </p>
          </div>
          <ThemePresetGrid />
        </section>

        <div className="my-12 h-px bg-border" />

        <section
          className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr]"
          aria-labelledby="actions-heading"
        >
          <div>
            <p className="mb-2 text-xs font-bold tracking-[0.14em] text-link uppercase">
              Actions & status
            </p>
            <h2 id="actions-heading" className="text-2xl font-semibold tracking-tight">
              Clear outcomes, visible state
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Buttons name the result. Status never relies on color alone. Every control keeps a
              visible keyboard focus treatment.
            </p>
          </div>
          <Card>
            <CardContent className="grid gap-8 p-6">
              <div>
                <p className="mb-3 text-sm font-semibold">Action hierarchy</p>
                <div className="flex flex-wrap gap-3">
                  <Button>Save work order</Button>
                  <Button variant="secondary">Save draft</Button>
                  <Button variant="outline">Preview estimate</Button>
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="destructive">Void invoice</Button>
                  <Button disabled>Processing…</Button>
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold">Operational status</p>
                <div className="flex flex-wrap gap-3">
                  <StatusBadge tone="ready">Authorized</StatusBadge>
                  <StatusBadge tone="waiting">Awaiting customer</StatusBadge>
                  <StatusBadge tone="attention">Payment failed</StatusBadge>
                  <StatusBadge tone="neutral">Draft</StatusBadge>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <div className="my-12 h-px bg-border" />

        <section className="grid gap-8 lg:grid-cols-2" aria-labelledby="forms-heading">
          <div>
            <p className="mb-2 text-xs font-bold tracking-[0.14em] text-link uppercase">
              Forms & feedback
            </p>
            <h2 id="forms-heading" className="text-2xl font-semibold tracking-tight">
              The next action stays obvious.
            </h2>
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Find a customer or asset</CardTitle>
                <CardDescription>
                  Search by name, phone, email, VIN, registration, or internal reference.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-5">
                  <div>
                    <label htmlFor="customer-search" className="mb-2 block text-sm font-semibold">
                      Customer or asset
                    </label>
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        id="customer-search"
                        type="search"
                        className="pl-10"
                        placeholder="Try “Maya” or the last 8 of a VIN"
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Results will remain scoped to the active organization and allowed locations.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="service-note" className="mb-2 block text-sm font-semibold">
                      Service concern
                    </label>
                    <textarea
                      id="service-note"
                      className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground"
                      placeholder="Record the customer’s words before diagnosing the concern."
                    />
                  </div>
                </form>
              </CardContent>
              <CardFooter className="justify-end gap-3 border-t border-border pt-5">
                <Button variant="ghost">Clear</Button>
                <Button>Create work order</Button>
              </CardFooter>
            </Card>
          </div>

          <div className="space-y-3 lg:pt-20">
            <Alert variant="info">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Estimate saved as a draft</AlertTitle>
              <AlertDescription>
                Nothing has been sent to the customer. Review recipients and totals before
                presenting it.
              </AlertDescription>
            </Alert>
            <Alert variant="warning">
              <Clock3 aria-hidden="true" />
              <AlertTitle>Authorization is still pending</AlertTitle>
              <AlertDescription>
                The requested work cannot begin until Maya approves estimate revision 2.
              </AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <ShieldAlert aria-hidden="true" />
              <AlertTitle>Payment was not recorded</AlertTitle>
              <AlertDescription>
                The provider did not confirm the charge. No receipt was issued; retry or choose
                another payment method.
              </AlertDescription>
            </Alert>
            <Alert>
              <CheckCircle2 className="text-success" aria-hidden="true" />
              <AlertTitle>Work order is ready for pickup</AlertTitle>
              <AlertDescription>
                All authorized work is complete and the final balance is $418.76.
              </AlertDescription>
            </Alert>
          </div>
        </section>

        <div className="my-12 h-px bg-border" />

        <section aria-labelledby="data-heading">
          <div className="mb-6 max-w-2xl">
            <p className="mb-2 text-xs font-bold tracking-[0.14em] text-link uppercase">
              Dense data
            </p>
            <h2 id="data-heading" className="text-2xl font-semibold tracking-tight">
              Scannable without hiding important context.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Tables keep identifiers, people, assets, status, and money visible. On narrow screens,
              the region scrolls without collapsing fields into ambiguous cards.
            </p>
          </div>
          <Card className="overflow-hidden">
            <div
              className="overflow-x-auto rounded-lg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none"
              role="region"
              aria-labelledby="data-heading"
              tabIndex={0}
            >
              <table className="w-full min-w-3xl text-left text-sm">
                <caption className="sr-only">Representative open work orders</caption>
                <thead className="border-b border-border bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-semibold">
                      Work order
                    </th>
                    <th scope="col" className="px-5 py-3 font-semibold">
                      Customer
                    </th>
                    <th scope="col" className="px-5 py-3 font-semibold">
                      Asset
                    </th>
                    <th scope="col" className="px-5 py-3 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sampleRows.map((row) => (
                    <tr key={row.order} className="hover:bg-muted/45">
                      <th scope="row" className="px-5 py-4 font-mono text-xs font-semibold">
                        {row.order}
                      </th>
                      <td className="px-5 py-4 font-medium">{row.customer}</td>
                      <td className="px-5 py-4 text-muted-foreground">{row.asset}</td>
                      <td className="px-5 py-4">
                        <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
                      </td>
                      <td className="px-5 py-4 text-right font-mono font-semibold tabular-nums">
                        {row.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      </main>

      <footer className="mt-14 border-t border-border px-4 py-8 text-center text-xs text-muted-foreground sm:px-6">
        Preview data is fictional. This route demonstrates presentation only; it does not simulate
        persisted shop operations.
      </footer>
    </div>
  );
}
