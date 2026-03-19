import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
          messageFormat: '[{module}] {msg}',
        },
      },
});

function createLogger(module: string) {
  return rootLogger.child({ module });
}

export { createLogger, rootLogger };
