import { Plus } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { getSession } from '@/lib/dal';
import { db } from '@/lib/db';
import { repos, desc } from '@codeindexer/db';
import { eq } from '@codeindexer/db';
import { RepoCard } from '@/components/dashboard/repo-card';
import { EmptyState } from '@/components/dashboard/empty-state';

const GITHUB_APP_INSTALL_URL = 'https://github.com/apps/codeindexer-dev/installations/new';

export default async function DashboardPage() {
  const session = await getSession();

  const userRepos = await db.query.repos.findMany({
    where: eq(repos.userId, session.user.id),
    orderBy: [desc(repos.createdAt)],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Repositories</h1>
          <p className="text-sm text-muted-foreground">
            {userRepos.length > 0
              ? `${userRepos.length} ${userRepos.length === 1 ? 'repository' : 'repositories'} connected`
              : 'Connect your GitHub repositories to start indexing'}
          </p>
        </div>
        {userRepos.length > 0 && (
          <Button asChild size="sm">
            <a href={GITHUB_APP_INSTALL_URL} target="_blank" rel="noopener noreferrer">
              <Plus weight="bold" />
              Add Repository
            </a>
          </Button>
        )}
      </div>

      {userRepos.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {userRepos.map((repo) => (
            <RepoCard
              key={repo.id}
              fullName={repo.fullName}
              status={repo.status}
              isPrivate={repo.isPrivate}
              defaultBranch={repo.defaultBranch}
              fileCount={repo.fileCount}
              chunkCount={repo.chunkCount}
              lastIndexedAt={repo.lastIndexedAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}
