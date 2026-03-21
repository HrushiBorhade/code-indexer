'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { useTabLeader } from './use-tab-leader';

type SessionMessage =
  | { type: 'session-update'; user: { name: string; email: string; image?: string } }
  | { type: 'signed-out' };

/**
 * Cross-tab session synchronization using the Leader Election pattern.
 *
 * Leader tab: polls session periodically, broadcasts state to followers.
 * Follower tabs: listen for broadcasts, react to sign-out/session changes.
 * All tabs: redirect to /login on sign-out broadcast.
 */
export function useSessionSync() {
  const router = useRouter();

  const onMessage = useCallback(
    (data: unknown) => {
      const msg = data as SessionMessage;
      if (msg.type === 'signed-out') {
        router.push('/login');
      } else if (msg.type === 'session-update') {
        // Could update local state/cache here if needed
        router.refresh();
      }
    },
    [router],
  );

  const { isLeader, broadcast } = useTabLeader({
    channel: 'codeindexer-session',
    onMessage,
  });

  // Leader polls session every 4 minutes (cookie cache is 5 min)
  useEffect(() => {
    if (!isLeader) return;

    const interval = setInterval(
      async () => {
        const { data: session } = await authClient.getSession();
        if (!session) {
          broadcast({ type: 'signed-out' });
          router.push('/login');
        } else {
          broadcast({
            type: 'session-update',
            user: { name: session.user.name, email: session.user.email, image: session.user.image },
          });
        }
      },
      4 * 60 * 1000,
    ); // 4 minutes

    return () => clearInterval(interval);
  }, [isLeader, broadcast, router]);

  return { isLeader, broadcast };
}
