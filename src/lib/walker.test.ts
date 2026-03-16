import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isBinary, walkFiles } from './walker.ts';

const execFileAsync = promisify(execFile);

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(path.join(tmpdir(), 'walker-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['add', '.'], { cwd: dir });
}

describe('isBinary', () => {
  it('detects binary files', async () => {
    const file = path.join(testDir, 'binary.ts');
    await writeFile(file, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expect(await isBinary(file)).toBe(true);
  });

  it('passes text files', async () => {
    const file = path.join(testDir, 'text.ts');
    await writeFile(file, 'const x = 1;');
    expect(await isBinary(file)).toBe(false);
  });

  it('treats empty files as non-binary', async () => {
    const file = path.join(testDir, 'empty.ts');
    await writeFile(file, '');
    expect(await isBinary(file)).toBe(false);
  });

  it('returns true for unreadable paths', async () => {
    expect(await isBinary(path.join(testDir, 'nope.ts'))).toBe(true);
  });
});

describe('walkFiles', () => {
  it('finds supported files in a git repo', async () => {
    await writeFile(path.join(testDir, 'index.ts'), 'const x = 1;');
    await writeFile(path.join(testDir, 'app.py'), 'x = 1');
    await writeFile(path.join(testDir, 'README.md'), '# Hello');
    await initGitRepo(testDir);

    const files = await walkFiles(testDir);
    const names = files.map((f) => path.basename(f));

    expect(names).toContain('index.ts');
    expect(names).toContain('app.py');
    expect(names).toContain('README.md');
  });

  it('skips unsupported extensions', async () => {
    await writeFile(path.join(testDir, 'index.ts'), 'const x = 1;');
    await writeFile(path.join(testDir, 'photo.png'), 'fakepng');
    await writeFile(path.join(testDir, 'app.exe'), 'fakeexe');
    await initGitRepo(testDir);

    const files = await walkFiles(testDir);
    const names = files.map((f) => path.basename(f));

    expect(names).toContain('index.ts');
    expect(names).not.toContain('photo.png');
    expect(names).not.toContain('app.exe');
  });

  it('skips files with no extension', async () => {
    await writeFile(path.join(testDir, 'Makefile'), 'all: build');
    await writeFile(path.join(testDir, 'Dockerfile'), 'FROM node');
    await writeFile(path.join(testDir, 'index.ts'), 'const x = 1;');
    await initGitRepo(testDir);

    const files = await walkFiles(testDir);
    const names = files.map((f) => path.basename(f));

    expect(names).toContain('index.ts');
    expect(names).not.toContain('Makefile');
    expect(names).not.toContain('Dockerfile');
  });

  it('skips binary files with supported extensions', async () => {
    await writeFile(path.join(testDir, 'corrupt.ts'), Buffer.from([0x00, 0x01, 0x02]));
    await writeFile(path.join(testDir, 'good.ts'), 'const x = 1;');
    await initGitRepo(testDir);

    const files = await walkFiles(testDir);
    const names = files.map((f) => path.basename(f));

    expect(names).toContain('good.ts');
    expect(names).not.toContain('corrupt.ts');
  });

  it('returns absolute paths', async () => {
    await writeFile(path.join(testDir, 'index.ts'), 'const x = 1;');
    await initGitRepo(testDir);

    const files = await walkFiles(testDir);

    for (const file of files) {
      expect(path.isAbsolute(file)).toBe(true);
    }
  });

  it('uses fast-glob fallback in non-git directories', async () => {
    await writeFile(path.join(testDir, 'index.ts'), 'const x = 1;');
    await writeFile(path.join(testDir, 'app.py'), 'x = 1');

    const files = await walkFiles(testDir);
    const names = files.map((f) => path.basename(f));

    expect(names).toContain('index.ts');
    expect(names).toContain('app.py');
  });

  it('returns empty array for empty directory', async () => {
    await initGitRepo(testDir);
    const files = await walkFiles(testDir);
    expect(files).toEqual([]);
  });

  it('finds files in subdirectories', async () => {
    await mkdir(path.join(testDir, 'src', 'utils'), { recursive: true });
    await writeFile(path.join(testDir, 'src', 'index.ts'), 'const x = 1;');
    await writeFile(path.join(testDir, 'src', 'utils', 'helper.ts'), 'export const y = 2;');
    await initGitRepo(testDir);

    const files = await walkFiles(testDir);
    const names = files.map((f) => path.basename(f));

    expect(names).toContain('index.ts');
    expect(names).toContain('helper.ts');
    expect(files.length).toBe(2);
  });

  it('handles many files concurrently', async () => {
    for (let i = 0; i < 25; i++) {
      await writeFile(path.join(testDir, `file${i}.ts`), `const x${i} = ${i};`);
    }
    await initGitRepo(testDir);

    const files = await walkFiles(testDir);
    expect(files.length).toBe(25);
  });
});
