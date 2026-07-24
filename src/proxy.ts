import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Performs an optimistic, cookie-existence-only redirect for the authenticated
 * application segment. This is intentionally NOT an authorization check: the
 * session cookie is not cryptographically validated here, and an attacker can
 * forge its presence. Every protected page, route handler, and server action
 * must still call `getCurrentSession()` (and, once implemented, rebuild the
 * tenant context) to authorize access server-side.
 *
 * The matcher is narrow until authenticated application routes exist; it avoids
 * matching the auth pages, API, and static assets.
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
  matcher: ["/app/:path*"],
};
