import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const statusConfig = {
  pending: { label: 'Pending', className: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400' },
  cloning: { label: 'Cloning...', className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  indexing: { label: 'Indexing...', className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  ready: { label: 'Ready', className: 'bg-green-500/15 text-green-600 dark:text-green-400' },
  error: { label: 'Error', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  stale: { label: 'Stale', className: 'bg-muted text-muted-foreground' },
} as const;

type RepoStatus = keyof typeof statusConfig;

export function RepoStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status as RepoStatus] ?? statusConfig.pending;

  return (
    <Badge
      variant="outline"
      className={cn('border-transparent font-mono text-xs', config.className)}
    >
      {config.label}
    </Badge>
  );
}
