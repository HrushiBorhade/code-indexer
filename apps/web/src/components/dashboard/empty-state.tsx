import { GithubLogo, Plus } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';

const GITHUB_APP_INSTALL_URL = 'https://github.com/apps/codeindexer-dev/installations/new';

export function EmptyState() {
  return (
    <div className="tui-corners-lg flex flex-col items-center justify-center py-16 text-center">
      <div className="flex size-12 items-center justify-center border border-border/30 bg-muted">
        <GithubLogo className="size-6 text-muted-foreground" weight="bold" />
      </div>
      <h3 className="tui-label mt-4 text-sm">No repositories yet</h3>
      <p className="mt-2 max-w-sm text-xs text-muted-foreground">
        Install the CodeIndexer GitHub App to connect your repositories and start indexing your
        codebase.
      </p>
      <Button asChild className="mt-6">
        <a href={GITHUB_APP_INSTALL_URL} target="_blank" rel="noopener noreferrer">
          <Plus weight="bold" />
          Add Repository
        </a>
      </Button>
    </div>
  );
}
