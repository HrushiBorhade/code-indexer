import { schemaTask, logger } from '@trigger.dev/sdk/v3';
import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  walkFiles,
  chunkFile,
  embedChunks,
  upsertPoints,
  ensureCollection,
  hashFiles,
  computeChanges,
  persistMerkleState,
  hashString,
} from '@codeindexer/core';
import type { Chunk, UpsertPoint } from '@codeindexer/core';
import { createDb, repos, chunkCache, eq } from '@codeindexer/db';

import { createAppJWT, getInstallationToken, downloadAndExtractTarball } from '../lib/github.js';
import { uploadBuffer, uploadFile, uploadRepoFiles, buildFileTree } from '../lib/r2.js';
import { DrizzleSyncStorage } from '../lib/drizzle-sync-storage.js';

const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace

const BATCH_SIZE = 50;

export const indexRepoTask = schemaTask({
  id: 'index-repo',
  schema: z.object({
    repoId: z.string().uuid(),
  }),
  run: async ({ repoId }) => {
    const db = createDb(process.env.DATABASE_URL!);
    let cloneDir = '';
    let tarballPath = '';

    try {
      // 1. Load repo from DB
      const repo = await db.query.repos.findFirst({
        where: eq(repos.id, repoId),
      });
      if (!repo) throw new Error(`Repo ${repoId} not found`);

      logger.info('Starting indexing', {
        repoId,
        fullName: repo.fullName,
        branch: repo.defaultBranch,
      });

      // 2. Set status 'cloning'
      await db
        .update(repos)
        .set({ status: 'cloning', indexError: null, updatedAt: new Date() })
        .where(eq(repos.id, repoId));

      // 3. Generate installation token
      const appJwt = createAppJWT(process.env.GITHUB_APP_ID!, process.env.GITHUB_APP_PRIVATE_KEY!);
      const token = await getInstallationToken(Number(repo.installationId), appJwt);

      // 4. Download + extract tarball
      cloneDir = path.join(tmpdir(), `codeindexer-${randomUUID()}`);
      tarballPath = `${cloneDir}.tar.gz`;
      const headSha = await downloadAndExtractTarball(
        repo.fullName,
        repo.defaultBranch,
        token,
        cloneDir,
        tarballPath,
      );

      logger.info('Tarball extracted', { headSha, cloneDir });

      // 5. Set status 'indexing'
      await db
        .update(repos)
        .set({ status: 'indexing', lastCommitSha: headSha, updatedAt: new Date() })
        .where(eq(repos.id, repoId));

      // 6. Walk files (no git — extracted tarball)
      const files = await walkFiles(cloneDir, { useGit: false });
      logger.info(`Found ${files.length} supported files`);

      // 7. Compute Merkle diff
      const storage = new DrizzleSyncStorage(db, repoId);
      const changes = await computeChanges(files, cloneDir, storage);

      if (changes.added.length === 0 && changes.modified.length === 0) {
        logger.info('No changes detected — skipping embedding');
        await db
          .update(repos)
          .set({
            status: 'ready',
            lastIndexedAt: new Date(),
            fileCount: files.length,
            updatedAt: new Date(),
          })
          .where(eq(repos.id, repoId));
        return { repoId, status: 'no-changes', fileCount: files.length };
      }

      // 8. Ensure Qdrant collection exists
      await ensureCollection();

      // 9. Batched pipeline: chunk → embed → upsert
      const changedFiles = [...changes.added, ...changes.modified];
      let totalChunks = 0;
      const successfulFiles = new Set<string>();

      for (let i = 0; i < changedFiles.length; i += BATCH_SIZE) {
        const batch = changedFiles.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(changedFiles.length / BATCH_SIZE);

        logger.info(`Processing batch ${batchNum}/${totalBatches} (${batch.length} files)`);

        // Chunk all files in batch
        const allChunks: Chunk[] = [];
        for (const file of batch) {
          const chunks = await chunkFile(file);
          allChunks.push(...chunks);
        }

        if (allChunks.length === 0) {
          batch.forEach((f) => successfulFiles.add(f));
          continue;
        }

        // Embed
        const embeddings = await embedChunks(allChunks);

        // Build upsert points with deterministic IDs
        const points: UpsertPoint[] = allChunks.map((chunk, idx) => {
          const chunkHash = hashString(chunk.content);
          const deterministicId = uuidv5(`${repoId}:${chunkHash}`, UUID_NAMESPACE);
          return {
            id: deterministicId,
            embedding: embeddings[idx]!,
            payload: {
              filePath: path.relative(cloneDir, chunk.filePath),
              lineStart: chunk.lineStart,
              lineEnd: chunk.lineEnd,
              language: chunk.language,
              chunkHash,
              repo_id: repoId,
              content: chunk.content,
            },
          };
        });

        // Upsert to Qdrant
        const ids = await upsertPoints(points);

        // Save chunk cache entries
        for (let j = 0; j < allChunks.length; j++) {
          const chunk = allChunks[j]!;
          const chunkHash = hashString(chunk.content);
          await db
            .insert(chunkCache)
            .values({
              repoId,
              chunkHash,
              qdrantId: ids[j]!,
              filePath: path.relative(cloneDir, chunk.filePath),
              lineStart: chunk.lineStart,
              lineEnd: chunk.lineEnd,
            })
            .onConflictDoUpdate({
              target: [chunkCache.repoId, chunkCache.chunkHash],
              set: {
                qdrantId: ids[j]!,
                filePath: path.relative(cloneDir, chunk.filePath),
                lineStart: chunk.lineStart,
                lineEnd: chunk.lineEnd,
              },
            });
        }

        totalChunks += allChunks.length;
        batch.forEach((f) => successfulFiles.add(f));
      }

      // 10. Persist Merkle state
      const fileHashMap = await hashFiles(files);
      await persistMerkleState(files, fileHashMap, successfulFiles, cloneDir, storage);

      // 11. Upload to R2
      logger.info('Uploading to R2...');
      await uploadFile(`repos/${repoId}/tarball.tar.gz`, tarballPath);

      const fileTree = buildFileTree(files, cloneDir);
      await uploadBuffer(
        `repos/${repoId}/file-tree.json`,
        Buffer.from(JSON.stringify(fileTree)),
        'application/json',
      );

      await uploadRepoFiles(repoId, files, cloneDir);

      // 12. Update repo status to 'ready'
      await db
        .update(repos)
        .set({
          status: 'ready',
          lastIndexedAt: new Date(),
          fileCount: files.length,
          chunkCount: totalChunks,
          r2TarKey: `repos/${repoId}/tarball.tar.gz`,
          updatedAt: new Date(),
        })
        .where(eq(repos.id, repoId));

      logger.info('Indexing complete', {
        repoId,
        files: files.length,
        chunks: totalChunks,
        changed: changedFiles.length,
      });

      return {
        repoId,
        status: 'ready',
        fileCount: files.length,
        chunkCount: totalChunks,
        changedFiles: changedFiles.length,
      };
    } catch (error) {
      logger.error('Indexing failed', { repoId, error: String(error) });

      // Set error status
      await db
        .update(repos)
        .set({
          status: 'error',
          indexError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(repos.id, repoId));

      throw error;
    } finally {
      // Cleanup temp files
      if (cloneDir) {
        await rm(cloneDir, { recursive: true, force: true }).catch(() => {});
      }
      if (tarballPath) {
        await rm(tarballPath, { force: true }).catch(() => {});
      }
    }
  },
});
