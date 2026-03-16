import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { grepSearch } from './grep.ts';

describe('grep', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('finds exact text matches in files', async () => {
    await fs.writeFile(path.join(tmpDir, 'auth.ts'), 'function checkAuth() {\n  return true;\n}\n');

    const results = await grepSearch('checkAuth', tmpDir);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].code).toContain('checkAuth');
    expect(results[0].filePath).toContain('auth.ts');
  });

  it('returns empty array when no matches found', async () => {
    await fs.writeFile(path.join(tmpDir, 'empty.ts'), 'const x = 1;\n');

    const results = await grepSearch('nonexistentString12345', tmpDir);

    expect(results).toEqual([]);
  });

  it('respects limit parameter', async () => {
    // Create multiple files with the same keyword
    for (let i = 0; i < 10; i++) {
      await fs.writeFile(
        path.join(tmpDir, `file${i}.ts`),
        `function match${i}() { return "keyword"; }\n`,
      );
    }

    const results = await grepSearch('keyword', tmpDir, 3);

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('uses smart case (case-insensitive by default)', async () => {
    await fs.writeFile(path.join(tmpDir, 'case.ts'), 'function HandleRequest() {}\n');

    const results = await grepSearch('handlerequest', tmpDir);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].code).toContain('HandleRequest');
  });

  it('includes language from file extension', async () => {
    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'const app = express();\n');

    const results = await grepSearch('express', tmpDir);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].language).toBe('typescript');
  });

  it('groups consecutive matches in same file', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'multi.ts'),
      'const a = "token";\nconst b = "token";\nconst c = "token";\n',
    );

    const results = await grepSearch('token', tmpDir);

    // Should be grouped into one result (lines within 5 of each other)
    expect(results).toHaveLength(1);
    expect(results[0].lineStart).toBe(1);
    expect(results[0].lineEnd).toBe(3);
  });

  it('returns results with score 1.0', async () => {
    await fs.writeFile(path.join(tmpDir, 'scored.ts'), 'const test = true;\n');

    const results = await grepSearch('test', tmpDir);

    if (results.length > 0) {
      expect(results[0].score).toBe(1.0);
    }
  });
});
