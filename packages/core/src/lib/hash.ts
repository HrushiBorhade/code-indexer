import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('hash');

/**
 * Compute SHA-256 hash of a file's contents.
 * Returns the hex-encoded digest (64-char string).
 */
async function hashFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch (err: unknown) {
    log.error(`Failed to hash file ${filePath}: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

/**
 * Compute SHA-256 hash of a string (used for chunk content hashing).
 * Returns the hex-encoded digest.
 */
function hashString(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export { hashFile, hashString };
