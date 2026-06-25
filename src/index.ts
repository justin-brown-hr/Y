import dotenv from 'dotenv';
dotenv.config({ override: true });
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config.js';
import { registerRoutes } from './api/routes.js';
import { JobManager } from './jobs/job-manager.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const jobs = new JobManager(config);

  await app.register(cors, { origin: true });
  registerRoutes(app, jobs, config);
  await jobs.init();

  const shutdown = async () => {
    app.log.info('Shutting down...');
    await jobs.shutdown();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Yodobashi checkout API listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
