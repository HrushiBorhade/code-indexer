import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { repos, account } from '@codeindexer/db/schema';
import { eq, and } from '@codeindexer/db';
import { db } from '@/lib/db';
import { tasks } from '@trigger.dev/sdk/v3';

if (!process.env.GITHUB_APP_WEBHOOK_SECRET)
  throw new Error('GITHUB_APP_WEBHOOK_SECRET is required');

// ─── Zod schemas for webhook payloads ───

const repoSchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string(),
  private: z.boolean().optional().default(false),
  default_branch: z.string().optional().default('main'),
});

const installationSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({ id: z.number().int().positive() }),
});

const installationEventSchema = z.object({
  action: z.string(),
  installation: installationSchema,
  repositories: z.array(repoSchema).optional(),
});

const installationReposEventSchema = z.object({
  action: z.string(),
  installation: installationSchema,
  repositories_added: z.array(repoSchema).optional(),
  repositories_removed: z
    .array(z.object({ id: z.number().int(), full_name: z.string() }))
    .optional(),
});

// ─── Webhook signature verification ───
// Compares raw 32-byte digest buffers (not hex strings) for constant-time safety.

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
  if (actual.byteLength !== 32) return false;
  return timingSafeEqual(expected, actual);
}

// ─── Route handler ───

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('X-Hub-Signature-256');
  const event = req.headers.get('X-GitHub-Event');

  if (!signature || !verifySignature(body, signature, process.env.GITHUB_APP_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    const payload = JSON.parse(body);

    switch (event) {
      case 'installation':
        await handleInstallation(payload);
        break;
      case 'installation_repositories':
        await handleInstallationRepositories(payload);
        break;
      case 'push':
        // Phase 2: will trigger re-indexing via Trigger.dev
        break;
    }
  } catch (error) {
    console.error(`Webhook ${event} processing failed:`, error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ─── Handlers ───

async function upsertRepos(
  userId: string,
  installationId: number,
  repositories: z.infer<typeof repoSchema>[],
) {
  // Batch upserts with Promise.all — avoids sequential HTTP round-trips to Neon
  const results = await Promise.all(
    repositories.map((repo) =>
      db
        .insert(repos)
        .values({
          userId,
          githubId: BigInt(repo.id),
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
          installationId: BigInt(installationId),
          isPrivate: repo.private,
          status: 'pending',
        })
        .onConflictDoUpdate({
          target: [repos.userId, repos.githubId],
          set: {
            installationId: BigInt(installationId),
            defaultBranch: repo.default_branch,
            isPrivate: repo.private,
            status: 'pending',
            updatedAt: new Date(),
          },
        })
        .returning({ id: repos.id }),
    ),
  );

  // Trigger indexing for each upserted repo
  for (const rows of results) {
    const repoId = rows[0]?.id;
    if (repoId) {
      await tasks.trigger('index-repo', { repoId }, { idempotencyKey: `index-${repoId}` });
    }
  }
}

async function findUserByGitHubAccountId(githubAccountId: string) {
  return db.query.account.findFirst({
    where: and(eq(account.providerId, 'github'), eq(account.accountId, githubAccountId)),
  });
}

async function handleInstallation(raw: unknown) {
  const payload = installationEventSchema.parse(raw);

  if (payload.action === 'deleted') {
    console.log(`GitHub App uninstalled: installation ${payload.installation.id}`);
    return;
  }

  if (payload.action !== 'created') return;

  const { installation, repositories } = payload;
  if (!repositories?.length) {
    console.log(
      `Installation ${installation.id} created with no repos — expecting installation_repositories event`,
    );
    return;
  }

  const githubAccountId = String(installation.account.id);
  const userAccount = await findUserByGitHubAccountId(githubAccountId);

  if (!userAccount) {
    console.warn(`No user found for GitHub account ${githubAccountId} — webhook dropped`);
    return;
  }

  await upsertRepos(userAccount.userId, installation.id, repositories);
}

async function handleInstallationRepositories(raw: unknown) {
  const payload = installationReposEventSchema.parse(raw);
  const { installation, repositories_added, repositories_removed } = payload;

  if (repositories_added?.length) {
    const githubAccountId = String(installation.account.id);
    const userAccount = await findUserByGitHubAccountId(githubAccountId);
    if (!userAccount) return;

    await upsertRepos(userAccount.userId, installation.id, repositories_added);
  }

  if (repositories_removed?.length) {
    for (const repo of repositories_removed) {
      console.log(`Repo removed from installation: ${repo.full_name}`);
    }
  }
}
