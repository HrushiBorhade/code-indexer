import { createLogger } from '../utils/logger.ts';

const log = createLogger('shutdown');

type CleanupFn = () => void | Promise<void>;

const cleanupFns: CleanupFn[] = [];
let isShuttingDown = false;
let handlersRegistered = false;

function onShutdown(fn: CleanupFn): void {
  cleanupFns.push(fn);
}

async function runCleanup(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info('Shutting down gracefully...');

  for (const fn of cleanupFns) {
    try {
      await fn();
    } catch (err: unknown) {
      log.error(`Cleanup error: ${err instanceof Error ? err.message : err}`);
    }
  }

  log.info('Cleanup complete');
}

function registerShutdownHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const handler = async (signal: NodeJS.Signals) => {
    log.info(`Received ${signal}`);
    await runCleanup();
    process.exit(0);
  };

  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

export { onShutdown, runCleanup, registerShutdownHandlers };
