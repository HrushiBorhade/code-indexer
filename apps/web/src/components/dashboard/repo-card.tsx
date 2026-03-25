import { Lock, GitBranch, FileCode, Cube, Clock } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RepoStatusBadge } from './repo-status-badge';

type RepoCardProps = {
  fullName: string;
  status: string;
  isPrivate: boolean;
  defaultBranch: string;
  fileCount: number | null;
  chunkCount: number | null;
  lastIndexedAt: Date | string | null;
};

function formatRelativeTime(value: Date | string | null): string {
  if (!value) return 'Never';
  const date = typeof value === 'string' ? new Date(value) : value;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function RepoCard({
  fullName,
  status,
  isPrivate,
  defaultBranch,
  fileCount,
  chunkCount,
  lastIndexedAt,
}: RepoCardProps) {
  const [owner, name] = fullName.split('/');

  return (
    <Card className="transition-colors hover:tui-corners-active">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="truncate font-mono text-sm font-medium">
            <span className="text-muted-foreground">{owner}/</span>
            {name}
          </CardTitle>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isPrivate && <Lock className="size-3.5 text-muted-foreground" weight="bold" />}
          <RepoStatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <GitBranch className="size-3.5" weight="bold" />
            {defaultBranch}
          </span>
          {fileCount ? (
            <span className="flex items-center gap-1">
              <FileCode className="size-3.5" weight="bold" />
              {fileCount.toLocaleString()} files
            </span>
          ) : null}
          {chunkCount ? (
            <span className="flex items-center gap-1">
              <Cube className="size-3.5" weight="bold" />
              {chunkCount.toLocaleString()} chunks
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" weight="bold" />
            {formatRelativeTime(lastIndexedAt)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
