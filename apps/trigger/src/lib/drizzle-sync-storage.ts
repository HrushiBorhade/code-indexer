import type { SyncStorage } from '@codeindexer/core';
import { type Database, fileHashes, dirHashes, eq, and } from '@codeindexer/db';

export class DrizzleSyncStorage implements SyncStorage {
  constructor(
    private db: Database,
    private repoId: string,
  ) {}

  async getFileHash(filePath: string): Promise<string | null> {
    const row = await this.db.query.fileHashes.findFirst({
      where: and(eq(fileHashes.repoId, this.repoId), eq(fileHashes.filePath, filePath)),
    });
    return row?.sha256 ?? null;
  }

  async setFileHash(filePath: string, hash: string): Promise<void> {
    await this.db
      .insert(fileHashes)
      .values({
        repoId: this.repoId,
        filePath,
        sha256: hash,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [fileHashes.repoId, fileHashes.filePath],
        set: { sha256: hash, updatedAt: new Date() },
      });
  }

  async getDirHash(dirPath: string): Promise<string | null> {
    const row = await this.db.query.dirHashes.findFirst({
      where: and(eq(dirHashes.repoId, this.repoId), eq(dirHashes.dirPath, dirPath)),
    });
    return row?.merkleHash ?? null;
  }

  async setDirHash(dirPath: string, hash: string): Promise<void> {
    await this.db
      .insert(dirHashes)
      .values({
        repoId: this.repoId,
        dirPath,
        merkleHash: hash,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dirHashes.repoId, dirHashes.dirPath],
        set: { merkleHash: hash, updatedAt: new Date() },
      });
  }

  async clearDirHashes(): Promise<void> {
    await this.db.delete(dirHashes).where(eq(dirHashes.repoId, this.repoId));
  }

  async getAllFileHashes(): Promise<Map<string, string>> {
    const rows = await this.db.query.fileHashes.findMany({
      where: eq(fileHashes.repoId, this.repoId),
    });
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.filePath, row.sha256);
    }
    return map;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Neon HTTP driver does not support interactive transactions.
    // Each query is auto-committed, so we just run fn sequentially.
    return fn();
  }
}
