'use client';

import { useState } from 'react';
import { GithubLogo, Terminal, MagnifyingGlass, Lightning } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
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
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left — branding panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r bg-muted/50 p-10 lg:flex">
        <div className="flex items-center gap-2 font-mono text-sm font-semibold">
          <Terminal className="size-5" weight="bold" />
          CodeIndexer
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <span className="text-green-500">$</span> codeindexer search &quot;authentication
              middleware&quot;
            </div>
            <div className="rounded-md border bg-card p-4 font-mono text-xs leading-relaxed">
              <div className="text-muted-foreground">
                Found <span className="text-foreground">12 results</span> across{' '}
                <span className="text-foreground">3 repositories</span>
              </div>
              <div className="mt-2 space-y-1.5">
                <div>
                  <span className="text-blue-400">src/proxy.ts</span>
                  <span className="text-muted-foreground">:12</span>
                  <span className="ml-2 text-muted-foreground">— optimistic cookie check</span>
                </div>
                <div>
                  <span className="text-blue-400">src/lib/dal.ts</span>
                  <span className="text-muted-foreground">:8</span>
                  <span className="ml-2 text-muted-foreground">— cached session verification</span>
                </div>
                <div>
                  <span className="text-blue-400">src/lib/auth.ts</span>
                  <span className="text-muted-foreground">:14</span>
                  <span className="ml-2 text-muted-foreground">— betterAuth config</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MagnifyingGlass className="size-3.5" weight="bold" />
            Semantic Search
          </span>
          <span className="flex items-center gap-1.5">
            <Lightning className="size-3.5" weight="bold" />
            AST Chunking
          </span>
          <span className="flex items-center gap-1.5">
            <Terminal className="size-3.5" weight="bold" />
            Hybrid Search
          </span>
        </div>
      </div>

      {/* Right — sign in */}
      <div className="flex flex-col items-center justify-center p-6 lg:p-10">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center">
            <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg border bg-card lg:hidden">
              <Terminal className="size-5" weight="bold" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Sign in to CodeIndexer</h1>
            <p className="text-sm text-muted-foreground">
              Connect your GitHub account to index and search your codebase
            </p>
          </div>

          <Button className="w-full" size="lg" onClick={handleGitHubSignIn} disabled={loading}>
            <GithubLogo weight="bold" />
            {loading ? 'Redirecting...' : 'Continue with GitHub'}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            By signing in, you agree to grant read access to your selected repositories.
          </p>
        </div>
      </div>
    </div>
  );
}
