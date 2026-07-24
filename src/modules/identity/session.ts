import { headers } from "next/headers";

import { auth } from "@/modules/identity/auth";

export type Session = typeof auth.$Infer.Session;

/**
 * Resolves the authenticated Better Auth session for the current request.
 *
 * This establishes the identity boundary only. It is the foundation for the
 * tenant-aware request context (issue #9), which will rebuild ShopOS
 * organization membership, permissions, and location access from server-side
 * records. The active organization stored on the session is a selection hint
 * and must never be treated as authorization on its own (ADR 0005).
 *
 * Returns `null` when no valid session is present so callers can distinguish
 * "unauthenticated" from an error.
 */
export async function getCurrentSession(): Promise<Session | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session ?? null;
}
