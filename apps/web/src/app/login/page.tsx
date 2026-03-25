'use client';

import { useState } from 'react';
import { GithubLogo, Terminal, ArrowLeft } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';

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
    <div className="relative min-h-screen">
      {/* Outer square border frame — flush to viewport with thin inset */}
      <div className="relative grid min-h-screen border border-border/30 m-3 lg:grid-cols-2">
        {/* Left — branding + auth */}
        <div className="flex flex-col justify-between p-8 lg:p-12">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" weight="bold" />
              Back
            </Link>
          </div>

          <div className="mx-auto w-full max-w-sm space-y-8">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <span>Code</span>
                <span className="inline-flex size-7 items-center justify-center border border-primary bg-primary text-xs font-bold text-primary-foreground">
                  I
                </span>
                <span>ndexer</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Semantic code search for your repositories
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-primary/50 text-primary">
                <span className="mr-1 inline-block size-1.5 bg-primary" />
                EARLY ACCESS
              </Badge>
              <span className="text-xs text-muted-foreground">
                Be one of the first <span className="font-semibold text-foreground">100</span> users.
              </span>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
                Your Code Is Ready.
                <br />
                <span className="text-primary">Search Smarter.</span>
              </h1>
              <p className="text-sm text-muted-foreground">
                Connect your GitHub repos, index with AST-aware chunking, and search your entire
                codebase by meaning. Get started now.
              </p>
            </div>

            <Button
              className="w-full border border-primary"
              size="lg"
              onClick={handleGitHubSignIn}
              disabled={loading}
            >
              <GithubLogo weight="bold" />
              {loading ? 'Redirecting...' : 'Continue with GitHub'}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} CodeIndexer. All rights reserved.
          </p>
        </div>

        {/* Right — hero image panel */}
        <div className="relative hidden overflow-hidden border-l border-border/30 lg:block">
          <div className="relative size-full">
            {/* Gradient placeholder for hero image */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-primary/5" />

            {/* Terminal overlay pattern — scanlines */}
            <div className="absolute inset-0 opacity-10" style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, currentColor 2px, currentColor 3px)',
              backgroundSize: '100% 3px',
            }} />

            {/* Content overlay at bottom */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/80 to-transparent p-8 pt-16">
              <div className="space-y-3">
                <span className="tui-label">CodeIndexer</span>
                <h2 className="text-2xl font-bold tracking-tight">
                  Find the <span className="text-primary">Signal.</span>
                  <br />
                  Skip the <span className="text-primary">Noise.</span>
                </h2>
                <div className="h-px w-16 bg-primary" />
                <p className="max-w-sm text-sm text-muted-foreground">
                  Search by meaning across every function, class, and module. Powered by tree-sitter
                  AST parsing and vector embeddings.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
