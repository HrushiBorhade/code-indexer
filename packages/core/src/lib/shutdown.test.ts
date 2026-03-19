import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need a fresh module for each test because shutdown has module-level state
type CleanupFn = () => void | Promise<void>;
let onShutdown: (fn: CleanupFn) => void;
let runCleanup: () => Promise<void>;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./shutdown.ts');
  onShutdown = mod.onShutdown;
  runCleanup = mod.runCleanup;
});

describe('shutdown', () => {
  it('runs registered cleanup functions in order', async () => {
    const order: number[] = [];

    onShutdown(() => {
      order.push(1);
    });
    onShutdown(() => {
      order.push(2);
    });
    onShutdown(() => {
      order.push(3);
    });

    await runCleanup();

    expect(order).toEqual([1, 2, 3]);
  });

  it('handles async cleanup functions', async () => {
    let cleaned = false;

    onShutdown(async () => {
      await new Promise((r) => setTimeout(r, 10));
      cleaned = true;
    });

    await runCleanup();

    expect(cleaned).toBe(true);
  });

  it('continues cleanup even if one function throws', async () => {
    const results: string[] = [];

    onShutdown(() => {
      results.push('first');
    });
    onShutdown(() => {
      throw new Error('cleanup failed');
    });
    onShutdown(() => {
      results.push('third');
    });

    await runCleanup();

    expect(results).toEqual(['first', 'third']);
  });

  it('only runs cleanup once (idempotent)', async () => {
    let count = 0;
    onShutdown(() => {
      count++;
    });

    await runCleanup();
    await runCleanup();

    expect(count).toBe(1);
  });

  it('does nothing with no registered functions', async () => {
    await expect(runCleanup()).resolves.toBeUndefined();
  });
});
