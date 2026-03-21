'use client';

import { useEffect, useRef, useCallback, useSyncExternalStore } from 'react';

/**
 * Leader Election + BroadcastChannel hook for cross-tab coordination.
 *
 * Uses Web Locks API for leader election (first tab to acquire wins).
 * Leader broadcasts messages to follower tabs via BroadcastChannel.
 * Automatic failover when leader tab closes — another tab promotes.
 *
 * Use cases:
 * - Session polling: only leader checks auth, broadcasts state
 * - SSE/WebSocket: only leader holds connection, forwards messages
 */

type TabLeaderOptions = {
  channel: string;
  onMessage?: (data: unknown) => void;
};

// Module-level store per channel — survives re-renders
const leaderStores = new Map<string, { isLeader: boolean; listeners: Set<() => void> }>();

function getStore(channel: string) {
  if (!leaderStores.has(channel)) {
    leaderStores.set(channel, { isLeader: false, listeners: new Set() });
  }
  return leaderStores.get(channel)!;
}

function setLeader(channel: string, value: boolean) {
  const store = getStore(channel);
  if (store.isLeader !== value) {
    store.isLeader = value;
    store.listeners.forEach((fn) => fn());
  }
}

export function useTabLeader({ channel, onMessage }: TabLeaderOptions) {
  const channelRef = useRef<BroadcastChannel | null>(null);

  const isLeader = useSyncExternalStore(
    (onStoreChange) => {
      const store = getStore(channel);
      store.listeners.add(onStoreChange);
      return () => store.listeners.delete(onStoreChange);
    },
    () => getStore(channel).isLeader,
    () => false, // server snapshot
  );

  const broadcast = useCallback((data: unknown) => {
    channelRef.current?.postMessage(data);
  }, []);

  useEffect(() => {
    const bc = new BroadcastChannel(channel);
    channelRef.current = bc;

    bc.onmessage = (event: MessageEvent) => {
      onMessage?.(event.data);
    };

    // Web Locks API for leader election
    if (typeof navigator !== 'undefined' && navigator.locks) {
      navigator.locks.request(`tab-leader-${channel}`, () => {
        setLeader(channel, true);
        // Hold lock forever — releases when tab closes
        return new Promise<void>(() => {});
      });
    } else {
      // No Web Locks — every tab is leader (graceful degradation)
      setLeader(channel, true);
    }

    return () => {
      bc.close();
      channelRef.current = null;
    };
  }, [channel, onMessage]);

  return { isLeader, broadcast };
}
