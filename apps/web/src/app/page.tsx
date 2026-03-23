import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MagnifyingGlass,
  Lightning,
  TreeStructure,
  GitBranch,
  Terminal,
  ArrowRight,
} from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  HeroBadge,
  HeroTitle,
  HeroDescription,
  HeroActions,
  HeroTerminal,
  FeatureCard,
} from '@/components/landing/hero-animations';

export const metadata: Metadata = {
  title: 'CodeIndexer — Semantic Code Search Engine',
  description:
    'Search your codebase by meaning. Connect GitHub repos, index with AST-aware chunking, search with natural language.',
};

const features = [
  {
    icon: MagnifyingGlass,
    title: 'Semantic Search',
    description:
      'Find code by meaning, not just keywords. Powered by OpenAI embeddings and vector search.',
  },
  {
    icon: TreeStructure,
    title: 'AST Chunking',
    description:
      'Intelligent code splitting using tree-sitter. Functions, classes, and types are kept intact.',
  },
  {
    icon: Lightning,
    title: 'Hybrid Search',
    description:
      'Reciprocal Rank Fusion merges semantic and text search for the best of both worlds.',
  },
  {
    icon: GitBranch,
    title: 'Incremental Sync',
    description: 'Merkle tree diffing detects changes instantly. Only re-indexes what changed.',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="flex h-14 items-center justify-between border-b px-6">
        <div className="flex items-center gap-2 font-mono text-sm font-semibold">
          <Terminal className="size-4" weight="bold" />
          CodeIndexer
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/login">Get Started</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <HeroBadge>
          <Badge variant="secondary" className="font-mono">
            Phase 1 — Open Source
          </Badge>
        </HeroBadge>

        <HeroTitle>
          Search your codebase
          <br />
          <span className="text-muted-foreground">by meaning</span>
        </HeroTitle>

        <HeroDescription>
          Semantic code search engine that understands your code. Connect your GitHub repos, index
          with AST-aware chunking, search with natural language.
        </HeroDescription>

        <HeroActions>
          <Button size="lg" asChild>
            <Link href="/login">
              Get Started
              <ArrowRight weight="bold" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a
              href="https://github.com/HrushiBorhade/code-indexer"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Terminal weight="bold" />
              View Source
            </a>
          </Button>
        </HeroActions>

        <HeroTerminal>
          <div className="overflow-hidden rounded-lg border bg-card shadow-2xl">
            <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
              <div className="size-2.5 rounded-full bg-red-500/60" />
              <div className="size-2.5 rounded-full bg-yellow-500/60" />
              <div className="size-2.5 rounded-full bg-green-500/60" />
              <span className="ml-2 font-mono text-xs text-muted-foreground">terminal</span>
            </div>
            <div className="p-4 font-mono text-xs leading-relaxed sm:p-6 sm:text-sm">
              <div className="text-muted-foreground">
                <span className="text-green-500">$</span> codeindexer search &quot;rate limiting
                middleware&quot;
              </div>
              <div className="mt-3 text-muted-foreground">
                Found <span className="font-medium text-foreground">8 results</span> in{' '}
                <span className="font-medium text-foreground">247ms</span>
              </div>
              <div className="mt-2 space-y-1">
                <div>
                  <span className="text-blue-400">src/middleware/rate-limit.ts</span>
                  <span className="text-muted-foreground">:14</span>
                  <span className="ml-2 text-muted-foreground">— sliding window rate limiter</span>
                </div>
                <div>
                  <span className="text-blue-400">src/api/routes/auth.ts</span>
                  <span className="text-muted-foreground">:87</span>
                  <span className="ml-2 text-muted-foreground">— login attempt throttling</span>
                </div>
                <div>
                  <span className="text-blue-400">src/lib/redis.ts</span>
                  <span className="text-muted-foreground">:42</span>
                  <span className="ml-2 text-muted-foreground">— token bucket implementation</span>
                </div>
              </div>
              <div className="mt-3 text-muted-foreground">
                <span className="text-green-500">$</span> <span className="animate-pulse">▌</span>
              </div>
            </div>
          </div>
        </HeroTerminal>
      </section>

      {/* Features */}
      <section className="border-t px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Built for developers
          </h2>
          <p className="mt-2 text-center text-muted-foreground">
            Every piece of the pipeline is designed for code, not generic text.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {features.map((feature, i) => (
              <FeatureCard key={feature.title} index={i}>
                <div className="group rounded-lg border p-6 transition-colors hover:border-foreground/20 hover:bg-muted/50">
                  <div className="flex size-9 items-center justify-center rounded-md border bg-background transition-colors group-hover:border-foreground/20">
                    <feature.icon className="size-4" weight="bold" />
                  </div>
                  <h3 className="mt-3 font-semibold">{feature.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
                </div>
              </FeatureCard>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">CodeIndexer</span>
          <a
            href="https://github.com/HrushiBorhade/code-indexer"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
