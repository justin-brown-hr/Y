import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { JobManager } from '../jobs/job-manager.js';
import type { Job, StartJobRequest } from '../jobs/types.js';
import { DiscordReporter } from '../services/discord.js';
import { parseProxyEntry } from '../config.js';
import { HttpSession } from '../http/http-session.js';
import { YodobashiHttpCheckout } from '../http/checkout.js';
import { parseScheduleCsv } from '../profiles/csv-import.js';

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
      return;
    }
  };
}

export function registerRoutes(app: FastifyInstance, jobs: JobManager, config: AppConfig): void {
  const auth = { preHandler: createAuthHook(config) };

  const dashboardHtml = readFileSync(join(process.cwd(), 'public/dashboard.html'), 'utf8');

  const serveDashboard = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.type('text/html').send(dashboardHtml);
  };

  app.get('/', serveDashboard);
  app.get('/dashboard', serveDashboard);

  app.get('/docs/profile.csv', async (_req, reply) => {
    try {
      const csv = readFileSync(join(process.cwd(), 'docs/profile.csv'), 'utf8');
      return reply.type('text/csv').send(csv);
    } catch {
      return reply.code(404).send({ error: 'profile.csv not found' });
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    accounts: config.accounts.length,
    proxies: config.proxies.length,
    maxParallelJobs: config.maxParallelJobs,
  }));

  app.get('/profiles/defaults', auth, async () => ({
    accounts: config.accounts.map((account, i) => ({
      id: `env-acc-${i}`,
      name: `User ${i + 1}`,
      email: account.email,
      password: account.password,
      source: 'env' as const,
    })),
    proxies: config.proxies.map((proxy, i) => ({
      id: `env-proxy-${i}`,
      name: `Proxy ${i + 1}`,
      host: proxy.host,
      value: `${proxy.host}:${proxy.port}:${proxy.username}:${proxy.password}`,
      source: 'env' as const,
    })),
    discordWebhook: config.discordWebhookUrl
      ? {
          id: 'env-discord',
          name: 'Discord',
          url: config.discordWebhookUrl,
          source: 'env' as const,
        }
      : null,
  }));

  app.post<{ Body: { webhookUrl?: string } }>('/discord/test', auth, async (request, reply) => {
    const url = request.body?.webhookUrl?.trim() || config.discordWebhookUrl;
    if (!url) return reply.code(400).send({ error: 'No webhook URL configured' });
    try {
      const reporter = new DiscordReporter(url);
      await reporter.report({
        success: true,
        jobId: 'test',
        mode: 'normal',
        account: 'test@example.com',
        productUrl: 'https://www.yodobashi.com/',
        orderId: 'TEST',
        durationMs: 0,
        timestamp: new Date().toISOString(),
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{
    Body: { accountEmail?: string; accountPassword?: string; proxy?: string };
  }>('/login/test', auth, async (request, reply) => {
    const email = request.body?.accountEmail?.trim() ?? config.accounts[0]?.email;
    const password = request.body?.accountPassword ?? config.accounts[0]?.password;
    const proxyRaw = request.body?.proxy?.trim();

    if (!email || !password) {
      return reply.code(400).send({ error: 'accountEmail and accountPassword required' });
    }

    let proxy;
    try {
      proxy = proxyRaw ? parseProxyEntry(proxyRaw) : config.proxies[0];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }

    const session = new HttpSession(proxy, config.navigationTimeoutMs, config.httpUseProxy);
    const checkout = new YodobashiHttpCheckout(config);
    const logs: Array<{ timestamp: string; level: string; message: string }> = [];
    const log = (message: string) => {
      logs.push({ timestamp: new Date().toISOString(), level: 'info', message });
    };

    try {
      await checkout.login(session, { email, password }, proxy, log);
      return { success: true, logs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push({ timestamp: new Date().toISOString(), level: 'error', message });
      return reply.code(400).send({
        success: false,
        error: message,
        logs,
      });
    }
  });

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

  app.post<{ Body: { jobs?: StartJobRequest[] } }>('/jobs/bulk', auth, async (request, reply) => {
    const list = request.body?.jobs;
    if (!Array.isArray(list) || list.length === 0) {
      return reply.code(400).send({ error: 'jobs array is required' });
    }
    for (const item of list) {
      if (!item.mode || !['normal', 'monitor'].includes(item.mode)) {
        return reply.code(400).send({ error: 'Each job must have mode normal or monitor' });
      }
    }
    try {
      const started = await jobs.startBulkJobs(list);
      return reply.code(202).send({ jobs: started.map(toSummary) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Body: { csv?: string } }>('/profiles/parse-csv', auth, async (request, reply) => {
    const csv = request.body?.csv;
    if (!csv?.trim()) return reply.code(400).send({ error: 'csv text is required' });
    try {
      const rows = parseScheduleCsv(csv);
      return { rows, count: rows.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

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

  app.delete<{ Params: { id: string } }>('/jobs/:id', auth, async (request, reply) => {
    const deleted = jobs.deleteJob(request.params.id);
    if (!deleted) return reply.code(404).send({ error: 'Job not found' });
    return { deleted: true, jobId: request.params.id };
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
    loginTime: job.loginTime,
    proxyHost: job.proxyHost,
    testMode: job.testMode,
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
