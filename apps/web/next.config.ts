import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: '../..',
  },
  // Guardrail: if someone accidentally imports @codeindexer/core from web,
  // these prevent Turbopack from trying to bundle native N-API modules
  serverExternalPackages: [
    'better-sqlite3',
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-javascript',
    'tree-sitter-python',
    'tree-sitter-rust',
    'tree-sitter-go',
    'tree-sitter-css',
  ],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
