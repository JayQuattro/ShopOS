import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Performs an optimistic, cookie-existence-only redirect for the authenticated
 * application, onboarding, and platform-administration segments. This is
 * intentionally NOT an authorization check: the session cookie is not
 * cryptographically validated here. Every protected page, route handler, and
 * server action must still call `getCurrentSession()` and rebuild the tenant
 * context server-side.
 *
 * The matcher avoids auth pages, API routes, and static assets.
 *
 * Locale negotiation (next-intl) is configured and ready in src/i18n/, but the
 * [locale] route segment has not been created yet. Until the route files are
 * moved under src/app/[locale]/, locale is resolved server-side from cookies
 * and Accept-Language (see src/app/layout.tsx). The next-intl middleware is
 * intentionally NOT composed here to avoid redirecting to /en-US/... which
 * 404s without the [locale] segment.
 */

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/platform/:path*"],
};
