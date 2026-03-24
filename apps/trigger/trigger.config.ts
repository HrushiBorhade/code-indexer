import { defineConfig } from '@trigger.dev/sdk/v3';

export default defineConfig({
  project: 'proj_codeindexer', // Update after creating Trigger.dev project
  dirs: ['./src/tasks'],
  runtime: 'node',
  maxDuration: 300,
  retries: {
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
    },
  },
  build: {
    external: ['better-sqlite3'],
  },
});
