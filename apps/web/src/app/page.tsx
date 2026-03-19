import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <Badge variant="secondary">Phase 1</Badge>
      <h1 className="text-4xl font-bold tracking-tight">CodeIndexer</h1>
      <p className="text-muted-foreground">Semantic code search engine</p>
      <Button asChild>
        <Link href="/dashboard">Go to Dashboard</Link>
      </Button>
    </div>
  );
}
