import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

export const logger = pino(
  {
    level: process.env['LOG_LEVEL'] ?? 'info',
    redact: ['password', 'token', 'secret', 'authorization', 'cookie'],
  },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined
);

export type Logger = typeof logger;
