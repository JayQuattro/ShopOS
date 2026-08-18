import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getCurrentSession } from "@/modules/identity/session";
import { resolvePortalLinks } from "@/modules/portal/portal-service";

export const dynamic = "force-dynamic";

/**
 * Portal landing: one card per shop this person is linked to as a customer.
 * No links means the account exists but isn't tied to any customer record.
 */
export default async function PortalHomePage() {
  const session = await getCurrentSession();

  const links = session ? await resolvePortalLinks(db, session.user.id) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Hello, ${session?.user.name ?? "there"}`}
        description="Your vehicles, service visits, and billing across your shops."
        breadcrumbs={[{ label: "Customer portal" }]}
      />

      {links.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              This account isn&apos;t linked to a customer profile yet. Ask your shop to send you a
              portal invite.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {links.map((link) => (
            <Link
              key={`${link.organizationId}-${link.customerId}`}
              href={`/portal/${link.organizationId}`}
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <p className="font-semibold">{link.organizationName}</p>
              <p className="mt-1 text-sm text-muted-foreground">Signed in as {link.customerName}</p>
              <p className="mt-2 text-sm text-link">View vehicles, visits, and billing →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
