// ============================================================
// Express Application — Main server setup with all middleware
// ============================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './lib/logger';
import { errorHandler } from './middleware/errorHandler';
import { auditMiddleware } from './middleware/audit';

// Route imports
import authRoutes from './routes/auth';
import passengerRoutes from './routes/passengers';
import applicationRoutes from './routes/applications';
import eventRoutes from './routes/events';
import reconciliationRoutes from './routes/reconciliation';
import ghostRoutes from './routes/ghosts';
import adminRoutes from './routes/admin';
import reportRoutes from './reports';
import importRoutes from './routes/import';
import metricsRoutes from './routes/metrics';

const app = express();

// ========================
// GLOBAL MIDDLEWARE
// ========================

// Security headers
app.use(helmet());

// CORS — support '*' or comma-separated origins
const corsOrigins = config.corsOrigin;
app.use(cors({
  origin: corsOrigins === '*' ? true : corsOrigins.split(',').map(s => s.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// HTTP request logging
app.use(morgan('combined', {
  stream: { write: (message) => logger.http(message.trim()) },
}));

// Rate limiting
app.use(rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
}));

// Audit context
app.use(auditMiddleware);

// ========================
// HEALTH CHECK (no auth needed)
// ========================
app.get('/health', async (_req, res) => {
  // Enhanced health check with subsystem status
  let dbStatus = 'UP';
  let redisStatus = 'UP';

  try {
    await (await import('./lib/prisma')).prisma.$queryRaw`SELECT 1`;
  } catch { dbStatus = 'DOWN'; }

  try {
    const redis = (await import('./lib/redis')).cache;
    await redis.ping();
  } catch { redisStatus = 'DOWN'; }

  const status = dbStatus === 'UP' && redisStatus === 'UP' ? 'ok' : 'degraded';

  res.json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: { database: dbStatus, redis: redisStatus },
  });
});

app.get('/ping', (_req, res) => {
  res.send('pong');
});

// Prometheus metrics (no auth required)
app.use('/metrics', metricsRoutes);

// ========================
// API ROUTES
// ========================
const prefix = config.apiPrefix;

app.use(`${prefix}/auth`, authRoutes);
app.use(`${prefix}/passengers`, passengerRoutes);
app.use(`${prefix}/applications`, applicationRoutes);
app.use(`${prefix}/events`, eventRoutes);
app.use(`${prefix}/reconciliation`, reconciliationRoutes);
app.use(`${prefix}/ghosts`, ghostRoutes);
app.use(`${prefix}/admin`, adminRoutes);
app.use(`${prefix}/reports`, reportRoutes);
app.use(`${prefix}/import`, importRoutes);

// ========================
// 404 HANDLER
// ========================
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist' },
  });
});

// ========================
// ERROR HANDLER (must be last)
// ========================
app.use(errorHandler);

export default app;
