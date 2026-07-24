import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "@/i18n/routing";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Composes two concerns:
 * 1. **Locale negotiation** (next-intl) — handles locale prefixing, Accept-Language
 *    negotiation, and redirects to the canonical locale-prefixed URL.
 * 2. **Session-cookie optimistic redirect** — redirects unauthenticated users from
 *    protected segments to the sign-in page.
 *
 * The session check is intentionally NOT an authorization check: the session
 * cookie is not cryptographically validated here. Every protected page, route
 * handler, and server action must still call `getCurrentSession()` and rebuild
 * the tenant context server-side.
 *
 * The matcher covers all human-facing routes. API routes (`/api/*`) are
 * intentionally excluded — they are locale-neutral.
 */

const intlMiddleware = createMiddleware(routing);

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // First, let next-intl handle locale negotiation/prefixing.
  const intlResponse = intlMiddleware(request);

  // Then check for session-cookie presence on protected segments.
  // The paths may or may not have a locale prefix at this point depending on
  // whether next-intl redirected. We check the original request path.
  const pathname = request.nextUrl.pathname;
  const isProtectedSegment =
    pathname.includes("/app/") ||
    pathname.includes("/onboarding/") ||
    pathname.includes("/platform/") ||
    /^\/(en-US|en-XA)\/(app|onboarding|platform)/.test(pathname);

  if (isProtectedSegment) {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
      const signInUrl = new URL("/sign-in", request.url);
      signInUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  return intlResponse;
}

export const config = {
  matcher: [
    // All routes except API, static files, and Next internals.
    "/((?!api|_next|_vercel|.*\\..*).*)",
  ],
};
