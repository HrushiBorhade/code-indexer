import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { getLanguage } from './languages.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('walker');

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

const FALLBACK_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/.cache/**',
  '**/vendor/**',
  '**/__pycache__/**',
  '**/target/**',
];

async function isBinary(filePath: string): Promise<boolean> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, 512, 0);
    if (bytesRead === 0) return false;
    return buffer.subarray(0, bytesRead).includes(0x00);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.warn(`Could not read ${filePath} for binary check (${code ?? err})`);
    }
    return true;
  } finally {
    await handle?.close();
  }
}

async function discoverFiles(rootDir: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '.'],
      { cwd: rootDir, maxBuffer: MAX_BUFFER },
    );
    return stdout.split('\n').filter(Boolean);
  } catch (err: unknown) {
    log.warn(
      `git ls-files failed, falling back to fast-glob (.gitignore rules will NOT apply): ${err instanceof Error ? err.message : err}`,
    );
    const files = await fg('**/*', {
      cwd: rootDir,
      ignore: FALLBACK_IGNORE,
      dot: false,
      absolute: false,
    });
    return files;
  }
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const resolvedRoot = path.resolve(rootDir);
  const relativePaths = await discoverFiles(resolvedRoot);
  const supported = relativePaths.filter((file) => getLanguage(file) !== undefined);

  const results = await Promise.all(
    supported.map(async (file) => {
      const abs = path.resolve(resolvedRoot, file);
      const binary = await isBinary(abs);
      return binary ? null : abs;
    }),
  );

  return results.filter((f): f is string => f !== null);
}

export { walkFiles, isBinary };
