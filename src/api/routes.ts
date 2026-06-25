import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { JobManager } from '../jobs/job-manager.js';
import type { Job, StartJobRequest } from '../jobs/types.js';

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({ error: 'Unauthorized' });
}

export function createAuthHook(config: AppConfig) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      unauthorized(reply);
      return;
    }
    const token = header.slice(7);
    if (token !== config.apiToken) {
      unauthorized(reply);
    }
  };
}

export function registerRoutes(app: FastifyInstance, jobs: JobManager, config: AppConfig): void {
  const auth = { preHandler: createAuthHook(config) };

  app.get('/health', async () => ({
    status: 'ok',
    accounts: config.accounts.length,
    proxies: config.proxies.length,
    maxParallelJobs: config.maxParallelJobs,
  }));

  app.post<{ Body: StartJobRequest & { allAccounts?: boolean } }>(
    '/jobs',
    auth,
    async (request, reply) => {
      const body = request.body;

      if (!body.mode || !['normal', 'monitor'].includes(body.mode)) {
        return reply.code(400).send({ error: 'mode must be "normal" or "monitor"' });
      }

      try {
        if (body.allAccounts) {
          const started = await jobs.startJobsForAllAccounts(body);
          return reply.code(202).send({ jobs: started.map(toSummary) });
        }

        const job = await jobs.startJob(body);
        return reply.code(202).send(toSummary(job));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.get('/jobs', auth, async () => ({
    jobs: jobs.listJobs().map(toSummary),
  }));

  app.get<{ Params: { id: string } }>('/jobs/:id', auth, async (request, reply) => {
    const job = jobs.getJob(request.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    return toDetail(job);
  });

  app.get<{ Params: { id: string } }>('/jobs/:id/logs', auth, async (request, reply) => {
    const job = jobs.getJob(request.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    return { jobId: job.id, logs: job.logs };
  });

  app.post<{ Params: { id: string } }>('/jobs/:id/cancel', auth, async (request, reply) => {
    const cancelled = jobs.cancelJob(request.params.id);
    if (!cancelled) {
      const job = jobs.getJob(request.params.id);
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      return reply.code(409).send({ error: 'Job cannot be cancelled', status: job.status });
    }
    return { cancelled: true, jobId: request.params.id };
  });
}

function toSummary(job: Job) {
  return {
    id: job.id,
    mode: job.mode,
    status: job.status,
    productUrls: job.productUrls,
    accountEmail: job.accountEmail,
    saleTime: job.saleTime,
    proxyHost: job.proxyHost,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    result: job.result,
  };
}

function toDetail(job: Job) {
  return {
    ...toSummary(job),
    logs: job.logs,
    cancelRequested: job.cancelRequested,
  };
}
