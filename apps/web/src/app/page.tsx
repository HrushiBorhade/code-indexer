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
  HeroDescription,
  HeroActions,
  FeatureCard,
} from '@/components/landing/hero-animations';
import { HeroDashboardDemo } from '@/components/landing/hero-dashboard-demo';

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
      <header className="flex h-12 items-center justify-between border-b border-border/30 px-6">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Terminal className="size-4" weight="bold" />
          <span className="tui-label">CodeIndexer</span>
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
      <section className="flex flex-col items-center px-6 pt-12 pb-16">
        <HeroBadge>
          <Badge variant="outline" className="border-primary/50 text-primary">
            Phase 1 — Open Source
          </Badge>
        </HeroBadge>

        <h1 className="mt-4 max-w-xl text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Search your codebase{' '}
          <span className="text-primary">by meaning</span>
        </h1>

        <HeroDescription>
          Connect GitHub repos, index with AST-aware chunking, search with natural language.
          Ask questions about your code and get instant answers.
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

        {/* Animated Dashboard Demo */}
        <div className="mt-12 w-full max-w-4xl px-4">
          <HeroDashboardDemo />
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/30 px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <h2 className="tui-label text-center text-base">Built for developers</h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Every piece of the pipeline is designed for code, not generic text.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {features.map((feature, i) => (
              <FeatureCard key={feature.title} index={i}>
                <div className="tui-corners group p-6 transition-colors">
                  <div className="flex size-9 items-center justify-center border border-border/30 bg-background transition-colors group-hover:border-primary/50">
                    <feature.icon className="size-4" weight="bold" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{feature.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{feature.description}</p>
                </div>
              </FeatureCard>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/30 px-6 py-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tui-label">CodeIndexer</span>
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
