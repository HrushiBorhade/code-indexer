import 'server-only';
import { cache } from 'react';
import { auth } from './auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

/** Cached session check. Redirects to /login if unauthenticated. */
export const getSession = cache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect('/login');
  return session;
});

/** Like getSession, but returns null instead of redirecting. */
export const getOptionalSession = cache(async () =>
  auth.api.getSession({
    headers: await headers(),
  }),
);
