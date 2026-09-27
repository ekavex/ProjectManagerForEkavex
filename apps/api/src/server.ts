/**
 * Process entry point: starts the HTTP server, the socket server and the scheduler, and
 * shuts all three down cleanly.
 */
import { createServer } from 'node:http';
import { assertProductionSafety, env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/prisma.js';
import { createApp } from './http/app.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { logger } from './lib/logger.js';
import { verifyTransport } from './mail/transport.js';
import { closeSocketServer, createSocketServer } from './realtime/socket-server.js';

async function main(): Promise<void> {
  assertProductionSafety();

  await connectDatabase();
  logger.info('Connected to the database');

  await verifyTransport();

  const app = createApp();
  const server = createServer(app);
  const io = createSocketServer(server);

  startScheduler();

  server.listen(env.API_PORT, () => {
    logger.info(
      { port: env.API_PORT, env: env.NODE_ENV, appUrl: env.APP_URL },
      'Ekavist API is listening',
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    stopScheduler();
    void closeSocketServer(io)
      .catch(() => undefined)
      .then(() => {
        server.close(() => {
          void disconnectDatabase().finally(() => process.exit(0));
        });
      });

    // Do not let a hung connection keep the process alive indefinitely.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'The API failed to start');
  // The logger is asynchronous in production; give it a moment to flush.
  setTimeout(() => process.exit(1), 100);
});
