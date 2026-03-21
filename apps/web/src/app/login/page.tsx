'use client';

import { useState } from 'react';
import { GithubLogo } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient } from '@/lib/auth-client';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  async function handleGitHubSignIn() {
    setLoading(true);
    try {
      await authClient.signIn.social({
        provider: 'github',
        callbackURL: '/dashboard',
      });
    } catch {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Sign in to CodeIndexer</CardTitle>
          <CardDescription>Connect your GitHub account to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" size="lg" onClick={handleGitHubSignIn} disabled={loading}>
            <GithubLogo weight="bold" />
            {loading ? 'Redirecting...' : 'Continue with GitHub'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
