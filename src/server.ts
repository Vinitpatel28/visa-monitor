// ============================================================
// Server Entry Point — Start the application
// ============================================================

import app from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';

async function main() {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('✅ PostgreSQL connected');

    // Start HTTP server
    const server = app.listen(config.port, () => {
      logger.info(`🚀 Visa Workflow API running on port ${config.port}`);
      logger.info(`📋 API prefix: ${config.apiPrefix}`);
      logger.info(`🌍 Environment: ${config.nodeEnv}`);
      logger.info(`❤️  Health check: http://localhost:${config.port}/health`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);
      server.close(async () => {
        await prisma.$disconnect();
        logger.info('Server shut down gracefully');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection', { reason });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });

  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

main();
