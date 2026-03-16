import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashFile, hashString } from './hash.ts';

describe('hash', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hash-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('hashFile', () => {
    it('returns a 64-character hex string', async () => {
      const filePath = path.join(tmpDir, 'sample.ts');
      await fs.writeFile(filePath, 'const x = 1;');

      const hash = await hashFile(filePath);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns the same hash for the same content', async () => {
      const filePath = path.join(tmpDir, 'stable.ts');
      await fs.writeFile(filePath, 'function hello() {}');

      const hash1 = await hashFile(filePath);
      const hash2 = await hashFile(filePath);

      expect(hash1).toBe(hash2);
    });

    it('returns different hashes for different content', async () => {
      const fileA = path.join(tmpDir, 'a.ts');
      const fileB = path.join(tmpDir, 'b.ts');
      await fs.writeFile(fileA, 'const a = 1;');
      await fs.writeFile(fileB, 'const b = 2;');

      const hashA = await hashFile(fileA);
      const hashB = await hashFile(fileB);

      expect(hashA).not.toBe(hashB);
    });

    it('matches hashString for the same content', async () => {
      const content = 'export function greet() { return "hi"; }';
      const filePath = path.join(tmpDir, 'greet.ts');
      await fs.writeFile(filePath, content);

      const fileHash = await hashFile(filePath);
      const stringHash = hashString(content);

      expect(fileHash).toBe(stringHash);
    });

    it('returns known SHA-256 for an empty file', async () => {
      const filePath = path.join(tmpDir, 'empty.txt');
      await fs.writeFile(filePath, '');

      const hash = await hashFile(filePath);

      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('throws on non-existent file', async () => {
      await expect(hashFile(path.join(tmpDir, 'missing.ts'))).rejects.toThrow();
    });
  });

  describe('hashString', () => {
    it('returns a 64-character hex string', () => {
      const hash = hashString('function hello() {}');

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns consistent results for the same input', () => {
      const input = 'const x = 42;';

      expect(hashString(input)).toBe(hashString(input));
    });

    it('returns different hashes for different input', () => {
      expect(hashString('hello')).not.toBe(hashString('world'));
    });

    it('returns the known SHA-256 of an empty string', () => {
      expect(hashString('')).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    });
  });
});
