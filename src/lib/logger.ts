// ============================================================
// Winston Logger — Structured JSON logging for production
// ============================================================

import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, errors, json, colorize, printf, splat } = winston.format;

// Custom format for development
const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${timestamp} [${level}]: ${message}${metaStr}`;
});

// Production format: structured JSON
const prodFormat = combine(
  timestamp({ format: 'ISO' }),
  errors({ stack: true }),
  splat(),
  json()
);

// Development format: colorized, human-readable
const developmentFormat = combine(
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  colorize(),
  splat(),
  devFormat
);

export const logger = winston.createLogger({
  level: config.log.level,
  format: config.nodeEnv === 'production' ? prodFormat : developmentFormat,
  defaultMeta: { service: 'visa-workflow-api' },
  transports: [
    new winston.transports.Console(),
    // File transport for production
    ...(config.nodeEnv === 'production'
      ? [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
});
