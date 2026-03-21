'use client';

import { useState } from 'react';
import { SignOut } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await authClient.signOut();
      const bc = new BroadcastChannel('codeindexer-session');
      bc.postMessage({ type: 'signed-out' });
      bc.close();
      router.push('/login');
    } catch {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSignOut} disabled={loading}>
      <SignOut weight="bold" />
      {loading ? 'Signing out...' : 'Sign out'}
    </Button>
  );
}
