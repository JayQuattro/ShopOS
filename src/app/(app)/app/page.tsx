import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { getCurrentSession } from "@/modules/identity/session";

/**
 * Redirects /app to the user's organization dashboard.
 * Redirects to the first active membership, or to onboarding if none.
 */
export default async function AppRedirect() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/sign-in");
  }

  const membership = await db.organizationMembership.findFirst({
    where: { userId: session.user.id, active: true },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { id: true, slug: true } } },
  });

  if (membership) {
    redirect(`/app/${membership.organization.id}`);
  }

  redirect("/onboarding/organization");
}
