import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Named export — per Next.js 16 docs.
 *
 * This is an OPTIMISTIC check — cookie exists ≠ valid session.
 * Real auth validation happens in the DAL (lib/dal.ts).
 * This just prevents flash of wrong page.
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request, {
    cookiePrefix: 'codeindexer',
  });
  const path = request.nextUrl.pathname;

  // Redirect unauthenticated users away from protected routes
  const isProtected = path.startsWith('/dashboard') || path.startsWith('/repo');
  if (isProtected && !sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Redirect authenticated users away from login
  if (path === '/login' && sessionCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
