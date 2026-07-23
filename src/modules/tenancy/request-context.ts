import { cache } from "react";
import { headers } from "next/headers";

import { db } from "@/db/client";
import { getCurrentSession } from "@/modules/identity/session";
import {
  resolveTenantContext,
  TenantContextNotResolved,
} from "@/modules/tenancy/resolve-tenant-context";
import type { TenantContext } from "@/modules/tenancy/policy";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Resolves the authoritative tenant context for the current request.
 *
 * Memoized via React 19 `cache()` so a single request resolves the context
 * once and shares it across every route handler, server component, and
 * application service invoked in that request. The context is rebuilt from
 * server-side membership and location-access records — never from browser
 * authority (ADR 0002, ADR 0005).
 *
 * The client-supplied organization is read from the Better Auth session's
 * `activeOrganizationId`, which is explicitly a selection hint and is
 * re-verified against stored membership here. Throws `TenantContextNotResolved`
 * when there is no session, no selected organization, or no active membership.
 *
 * Repositories and background jobs must take the resolved `TenantContext` as an
 * explicit argument rather than calling this function: jobs run outside the
 * request lifecycle where `headers()` and `cache()` are unavailable, and they
 * must carry and revalidate their own organization context.
 */
export const getRequestContext = cache(async (): Promise<TenantContext> => {
  const session = await getCurrentSession();

  if (!session) {
    throw new TenantContextNotResolved("unauthenticated");
  }

  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    throw new TenantContextNotResolved("organization_not_selected");
  }

  const requestId = (await readRequestId()) ?? globalRequestId();

  return resolveTenantContext({
    db,
    actorId: session.user.id,
    organizationId,
    requestId,
  });
});

async function readRequestId(): Promise<string | undefined> {
  const requestHeaders = await headers();
  const headerValue = requestHeaders.get(REQUEST_ID_HEADER);
  return headerValue ?? undefined;
}

/**
 * Generates a request correlation id when no inbound header is present. The id
 * is used for audit/event attribution (AuditEvent.requestId) and logging.
 */
function globalRequestId(): string {
  return crypto.randomUUID();
}
