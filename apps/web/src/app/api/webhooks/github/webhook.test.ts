import { createHmac, timingSafeEqual } from 'crypto';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── Re-declare schemas and verifySignature for testing ───
// These mirror the route handler's internals. In a larger app, extract to a shared module.

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

// Mirrors the route handler's verifySignature — compares raw 32-byte digest buffers
function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
  if (actual.byteLength !== 32) return false;
  return timingSafeEqual(expected, actual);
}

function createSignature(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// ─── Signature verification tests ───

describe('verifySignature', () => {
  const secret = 'test-webhook-secret';

  it('accepts valid signature', () => {
    const body = '{"action":"created"}';
    const signature = createSignature(body, secret);
    expect(verifySignature(body, signature, secret)).toBe(true);
  });

  it('rejects wrong signature', () => {
    const body = '{"action":"created"}';
    const signature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';
    expect(verifySignature(body, signature, secret)).toBe(false);
  });

  it('rejects tampered body', () => {
    const body = '{"action":"created"}';
    const signature = createSignature(body, secret);
    expect(verifySignature('{"action":"deleted"}', signature, secret)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const body = '{"action":"created"}';
    const signature = createSignature(body, secret);
    expect(verifySignature(body, signature, 'wrong-secret')).toBe(false);
  });

  it('rejects signature with different length', () => {
    const body = '{"action":"created"}';
    expect(verifySignature(body, 'sha256=short', secret)).toBe(false);
  });

  it('rejects empty signature', () => {
    const body = '{"action":"created"}';
    expect(verifySignature(body, '', secret)).toBe(false);
  });
});

// ─── Zod schema validation tests ───

describe('installationEventSchema', () => {
  it('parses valid installation.created payload', () => {
    const payload = {
      action: 'created',
      installation: { id: 12345, account: { id: 67890 } },
      repositories: [
        { id: 111, full_name: 'user/repo1', private: false, default_branch: 'main' },
        { id: 222, full_name: 'user/repo2', private: true, default_branch: 'develop' },
      ],
    };
    const result = installationEventSchema.parse(payload);
    expect(result.action).toBe('created');
    expect(result.repositories).toHaveLength(2);
    expect(result.repositories?.[0]?.full_name).toBe('user/repo1');
    expect(result.repositories?.[1]?.private).toBe(true);
    expect(result.repositories?.[1]?.default_branch).toBe('develop');
  });

  it('parses installation.deleted payload (no repositories)', () => {
    const payload = {
      action: 'deleted',
      installation: { id: 12345, account: { id: 67890 } },
    };
    const result = installationEventSchema.parse(payload);
    expect(result.action).toBe('deleted');
    expect(result.repositories).toBeUndefined();
  });

  it('defaults private to false and default_branch to main', () => {
    const payload = {
      action: 'created',
      installation: { id: 1, account: { id: 2 } },
      repositories: [{ id: 100, full_name: 'user/repo' }],
    };
    const result = installationEventSchema.parse(payload);
    expect(result.repositories?.[0]?.private).toBe(false);
    expect(result.repositories?.[0]?.default_branch).toBe('main');
  });

  it('rejects payload missing installation', () => {
    expect(() => installationEventSchema.parse({ action: 'created' })).toThrow();
  });

  it('rejects payload with non-numeric repo id', () => {
    const payload = {
      action: 'created',
      installation: { id: 1, account: { id: 2 } },
      repositories: [{ id: 'not-a-number', full_name: 'user/repo' }],
    };
    expect(() => installationEventSchema.parse(payload)).toThrow();
  });
});

describe('installationReposEventSchema', () => {
  it('parses repositories_added payload', () => {
    const payload = {
      action: 'added',
      installation: { id: 1, account: { id: 2 } },
      repositories_added: [
        { id: 100, full_name: 'user/new-repo', private: false, default_branch: 'main' },
      ],
    };
    const result = installationReposEventSchema.parse(payload);
    expect(result.repositories_added).toHaveLength(1);
    expect(result.repositories_added?.[0]?.full_name).toBe('user/new-repo');
  });

  it('parses repositories_removed payload', () => {
    const payload = {
      action: 'removed',
      installation: { id: 1, account: { id: 2 } },
      repositories_removed: [{ id: 100, full_name: 'user/old-repo' }],
    };
    const result = installationReposEventSchema.parse(payload);
    expect(result.repositories_removed).toHaveLength(1);
    expect(result.repositories_removed?.[0]?.full_name).toBe('user/old-repo');
  });

  it('handles both added and removed in same payload', () => {
    const payload = {
      action: 'added',
      installation: { id: 1, account: { id: 2 } },
      repositories_added: [{ id: 100, full_name: 'user/new-repo' }],
      repositories_removed: [{ id: 200, full_name: 'user/old-repo' }],
    };
    const result = installationReposEventSchema.parse(payload);
    expect(result.repositories_added).toHaveLength(1);
    expect(result.repositories_removed).toHaveLength(1);
  });
});

// ─── BigInt handling tests ───

describe('BigInt GitHub ID handling', () => {
  it('converts number to BigInt correctly', () => {
    const githubId = 123456789;
    expect(BigInt(githubId)).toBe(123456789n);
  });

  it('handles typical GitHub repo/installation IDs', () => {
    // Real-world GitHub IDs (currently well within safe integer range)
    const repoId = 891234567;
    const installationId = 54321678;
    expect(BigInt(repoId)).toBe(891234567n);
    expect(BigInt(installationId)).toBe(54321678n);
  });

  it('demonstrates precision loss without BigInt for unsafe integers', () => {
    // This is WHY we use mode: 'bigint' in the schema — future-proofing
    const unsafeId = Number.MAX_SAFE_INTEGER + 1;
    expect(unsafeId).toBe(Number.MAX_SAFE_INTEGER + 2); // JS number precision lost
  });
});
