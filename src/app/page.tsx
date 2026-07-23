import {
  ArrowRight,
  Blocks,
  Check,
  ExternalLink,
  Fingerprint,
  Landmark,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/shopos/status-badge";
import { ThemeSwitcher } from "@/components/shopos/theme/theme-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const foundationItems = [
  {
    label: "Tenant boundaries",
    detail: "Organization and location policies are explicit and denial-tested.",
    state: "Ready",
    icon: ShieldCheck,
  },
  {
    label: "Financial kernel",
    detail: "Labor, parts, fees, discounts, tax, and approval totals use minor units.",
    state: "Ready",
    icon: Landmark,
  },
  {
    label: "PostgreSQL model",
    detail: "The initial migration preserves tenant, estimate, and authorization history.",
    state: "Ready",
    icon: Blocks,
  },
  {
    label: "Identity & onboarding",
    detail: "Secure sessions and organization setup are the next implementation slice.",
    state: "Next",
    icon: Fingerprint,
  },
] as const;

const workflow = [
  "Customer",
  "Asset",
  "Work order",
  "Estimate",
  "Authorization",
  "Invoice",
  "Payment",
] as const;

export default function HomePage() {
  return (
    <div className="min-h-svh overflow-hidden bg-background">
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-24 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>

      <header className="relative z-20 border-b border-border/80 bg-background/90 backdrop-blur">
        <div className="mx-auto flex min-h-20 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a href="#top" className="group inline-flex min-h-11 items-center gap-3 rounded-md">
            <span
              className="grid size-10 place-items-center rounded-xl bg-foreground text-xs font-black tracking-tight text-background transition-transform group-hover:-rotate-2"
              aria-hidden="true"
            >
              SO
            </span>
            <span>
              <strong className="block text-base leading-tight tracking-tight">ShopOS</strong>
              <span className="block text-xs text-muted-foreground">Foundation workspace</span>
            </span>
          </a>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden min-h-8 gap-2 sm:inline-flex">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              Bootstrap environment
            </Badge>
            <ThemeSwitcher compact />
          </div>
        </div>
      </header>

      <main id="main-content">
        <section
          id="top"
          className="relative isolate border-b border-border px-4 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-28"
        >
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background: "radial-gradient(circle at 78% 18%, var(--hero-glow), transparent 34rem)",
            }}
            aria-hidden="true"
          />
          <div className="mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)] lg:gap-20">
            <div>
              <Badge variant="secondary" className="mb-5 uppercase tracking-[0.14em]">
                Open shop operations
              </Badge>
              <h1 className="max-w-4xl font-serif text-5xl leading-[0.98] font-medium tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl xl:text-[5.25rem]">
                Built around the work. Ready for every kind of shop.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
                A trustworthy path from customer concern to completed, authorized, and paid
                work—without locking the shop into a proprietary runtime.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <a href="#foundation">
                    Review the foundation
                    <ArrowRight aria-hidden="true" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/design-system">Explore the design system</Link>
                </Button>
                <Button asChild variant="link">
                  <a href="/api/health">
                    Service health
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>

            <Card className="relative overflow-hidden rounded-2xl">
              <CardHeader className="border-b border-border pb-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Badge variant="outline" className="mb-3">
                      Initial vertical workflow
                    </Badge>
                    <CardTitle className="text-xl">One clear path through the work</CardTitle>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">7 stages</span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ol className="divide-y divide-border">
                  {workflow.map((item, index) => (
                    <li
                      key={item}
                      className="grid min-h-14 grid-cols-[2.5rem_1fr_auto] items-center gap-2 px-6"
                    >
                      <span className="font-mono text-xs font-semibold text-primary">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="font-semibold">{item}</span>
                      <Check className="size-4 text-muted-foreground" aria-hidden="true" />
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </section>

        <section
          id="foundation"
          className="bg-sidebar px-4 py-20 text-sidebar-foreground sm:px-6 lg:px-8"
        >
          <div className="mx-auto w-full max-w-7xl">
            <div className="grid gap-6 border-b border-sidebar-border pb-10 lg:grid-cols-[1fr_0.65fr] lg:items-end lg:gap-16">
              <div>
                <p className="mb-4 text-xs font-bold tracking-[0.14em] text-sidebar-primary uppercase">
                  Bootstrap status
                </p>
                <h2 className="max-w-3xl font-serif text-4xl leading-tight font-medium tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl">
                  The dependable pieces come first.
                </h2>
              </div>
              <p className="max-w-xl leading-relaxed text-sidebar-foreground/70">
                This screen is an honest implementation marker—not a simulated shop workflow.
                Persisted operations arrive in vertical slices after identity and tenancy.
              </p>
            </div>

            <div className="grid lg:grid-cols-2">
              {foundationItems.map((item, index) => {
                const Icon = item.icon;

                return (
                  <article
                    key={item.label}
                    className="grid min-h-48 grid-cols-[2.5rem_1fr] gap-4 border-b border-sidebar-border py-8 lg:odd:border-r lg:odd:pr-8 lg:even:pl-8"
                  >
                    <span className="pt-1 font-mono text-xs text-sidebar-foreground/70">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-3">
                          <Icon className="size-5 text-sidebar-primary" aria-hidden="true" />
                          <h3 className="text-lg font-semibold">{item.label}</h3>
                        </span>
                        <StatusBadge
                          tone={item.state === "Ready" ? "ready" : "neutral"}
                          className="border-sidebar-border bg-sidebar-accent text-sidebar-foreground [&>svg]:text-sidebar-primary"
                        >
                          {item.state}
                        </StatusBadge>
                      </div>
                      <p className="max-w-lg text-sm leading-relaxed text-sidebar-foreground/65">
                        {item.detail}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card px-4 py-8 text-card-foreground sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 text-xs font-semibold text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>ShopOS · Bootstrap 0.2</span>
          <span>General domain, practical defaults, accessible by design.</span>
        </div>
      </footer>
    </div>
  );
}
