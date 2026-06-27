import type { AppConfig, ProxyConfig } from '../config.js';
import { parseJstSaleTime, parseProxyEntry, productUrlFromInput, randomPreLoginMs } from '../config.js';
import { BrowserPool, YodobashiAutomation } from '../browser/yodobashi.js';
import { YodobashiHttpCheckout } from '../http/checkout.js';
import { HttpSession } from '../http/http-session.js';
import { DiscordReporter } from '../services/discord.js';
import { ProxyPool } from '../services/proxy.js';
import { categorizeError, CheckoutError } from '../utils/errors.js';
import { isRetryableNetworkError } from '../browser/navigation.js';
import type { Job, JobLogEntry, JobRuntimeContext, StartJobRequest } from './types.js';
import { v4 as uuidv4 } from 'uuid';

function now(): string {
  return new Date().toISOString();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('cancelled'));
    });
  });
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly jobContext = new Map<string, JobRuntimeContext>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly proxyPool: ProxyPool;
  private readonly browserPool: BrowserPool;
  private readonly automation: YodobashiAutomation;
  private readonly httpCheckout: YodobashiHttpCheckout;
  private activeCount = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(private readonly config: AppConfig) {
    this.proxyPool = new ProxyPool(config.proxies);
    this.browserPool = new BrowserPool(config, this.proxyPool);
    this.automation = new YodobashiAutomation(config);
    this.httpCheckout = new YodobashiHttpCheckout(config);
  }

  async init(): Promise<void> {
    if (this.config.checkoutEngine === 'browser') {
      await this.browserPool.init();
    }
  }

  async shutdown(): Promise<void> {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    if (this.config.checkoutEngine === 'browser') {
      await this.browserPool.shutdown();
    }
  }

  listJobs(): Job[] {
    return [...this.jobs.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  private log(job: Job, level: JobLogEntry['level'], message: string): void {
    job.logs.push({ timestamp: now(), level, message });
    if (job.logs.length > 500) job.logs.shift();
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeCount < this.config.maxParallelJobs) {
      this.activeCount += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    this.activeCount += 1;
  }

  private releaseSlot(): void {
    this.activeCount -= 1;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  resolveProductUrls(req: StartJobRequest): string[] {
    if (req.mode === 'normal') {
      const input = req.productUrl ?? req.productCode;
      if (!input) throw new Error('productUrl or productCode is required for normal mode');
      return [productUrlFromInput(input)];
    }

    const urls = req.productUrls ?? (req.productUrl ? [req.productUrl] : []);
    if (urls.length === 0 && req.productCode) {
      return [productUrlFromInput(req.productCode)];
    }
    if (urls.length === 0) {
      throw new Error('productUrls is required for monitor mode');
    }
    return urls.map(productUrlFromInput);
  }

  private resolveJobContext(req: StartJobRequest, accountIndex: number): JobRuntimeContext {
    const hasCustom =
      req.accountEmail !== undefined ||
      req.accountPassword !== undefined ||
      req.proxy !== undefined;

    const discordWebhookUrl =
      req.discordWebhookUrl?.trim() || this.config.discordWebhookUrl || undefined;

    if (hasCustom) {
      if (this.config.checkoutEngine === 'browser') {
        throw new Error('Custom account/proxy only supported with CHECKOUT_ENGINE=http');
      }
      if (!req.accountEmail?.trim() || !req.accountPassword) {
        throw new Error('accountEmail and accountPassword are required with custom credentials');
      }
      if (!req.proxy?.trim()) {
        throw new Error('proxy is required (host:port:username:password)');
      }
      const proxy = parseProxyEntry(req.proxy);
      return {
        account: { email: req.accountEmail.trim(), password: req.accountPassword },
        proxy,
        discordWebhookUrl,
      };
    }

    const account = this.config.accounts[accountIndex];
    if (!account) {
      throw new Error(`No account at index ${accountIndex}. Configure ACCOUNTS env var.`);
    }
    return { account, proxy: this.proxyPool.at(accountIndex), discordWebhookUrl };
  }

  private discordForJob(jobId: string): DiscordReporter {
    const url =
      this.jobContext.get(jobId)?.discordWebhookUrl || this.config.discordWebhookUrl;
    return new DiscordReporter(url);
  }

  async startJob(req: StartJobRequest, accountIndex?: number): Promise<Job> {
    const idx = accountIndex ?? req.accountIndex ?? 0;
    const ctx = this.resolveJobContext(req, idx);

    const job: Job = {
      id: uuidv4(),
      mode: req.mode,
      status: 'pending',
      productUrls: this.resolveProductUrls(req),
      saleTime: req.saleTime ?? this.config.defaultSaleTime,
      accountEmail: ctx.account.email,
      proxyHost: ctx.proxy?.host,
      createdAt: now(),
      logs: [],
      cancelRequested: false,
      testMode: req.testMode ?? false,
    };

    if (job.testMode) {
      job.logs.push({ timestamp: now(), level: 'info', message: 'Test mode — no sale-time waits' });
    }

    this.jobs.set(job.id, job);
    this.jobContext.set(job.id, ctx);
    this.runJob(job, idx).catch((err) => {
      this.log(job, 'error', `Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
    });

    return job;
  }

  async startJobsForAllAccounts(req: StartJobRequest): Promise<Job[]> {
    if (req.accountEmail || req.accountPassword || req.proxy) {
      throw new Error('allAccounts cannot be used with custom accountEmail/accountPassword/proxy');
    }
    if (this.config.accounts.length === 0) {
      throw new Error('No accounts configured');
    }
    return Promise.all(
      this.config.accounts.map((_, i) => this.startJob({ ...req, accountIndex: i })),
    );
  }

  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return false;
    }
    job.cancelRequested = true;
    job.status = 'cancelled';
    this.abortControllers.get(id)?.abort();
    this.log(job, 'warn', 'Job cancelled');
    return true;
  }

  deleteJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    const active = ['pending', 'pre_login', 'waiting', 'running'];
    if (active.includes(job.status)) {
      this.cancelJob(id);
    }

    this.jobs.delete(id);
    this.jobContext.delete(id);
    this.abortControllers.delete(id);
    return true;
  }

  private async runJob(job: Job, accountIndex: number): Promise<void> {
    if (this.config.checkoutEngine === 'http') {
      return this.runJobHttp(job, accountIndex);
    }
    return this.runJobBrowser(job, accountIndex);
  }

  private async runJobHttp(job: Job, accountIndex: number): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(job.id, controller);
    await this.acquireSlot();

    const ctx = this.jobContext.get(job.id);
    const account = ctx?.account ?? this.config.accounts[accountIndex];
    const fixedProxy = ctx?.proxy;
    let proxyUsed: ProxyConfig | undefined;
    const maxProxyAttempts = fixedProxy ? 1 : Math.max(this.proxyPool.count, 1);

    try {
      if (job.cancelRequested) return;
      job.status = 'pre_login';
      job.startedAt = now();
      this.log(job, 'info', `Starting HTTP job (mode=${job.mode}, account=${job.accountEmail}${job.testMode ? ', TEST' : ''})`);

      let lastError: unknown;
      for (let attempt = 0; attempt < maxProxyAttempts; attempt++) {
        const proxy = fixedProxy ?? this.proxyPool.at(accountIndex + attempt);
        if (proxy) {
          job.proxyHost = proxy.host;
          proxyUsed = proxy;
          this.log(
            job,
            'info',
            fixedProxy
              ? `Using proxy ${proxy.host}:${proxy.port}`
              : `Using proxy ${proxy.host}:${proxy.port} (attempt ${attempt + 1}/${maxProxyAttempts})`,
          );
        }

        const session = new HttpSession(
          proxy,
          this.config.navigationTimeoutMs,
          this.config.httpUseProxy,
        );

        try {
          await this.executeJobHttp(job, session, account, proxy, controller.signal);
          return;
        } catch (err) {
          lastError = err;
          if (job.cancelRequested || (err instanceof Error && err.message === 'cancelled')) throw err;
          if (fixedProxy || !isRetryableNetworkError(err) || attempt === maxProxyAttempts - 1) throw err;
          const message = err instanceof Error ? err.message : String(err);
          this.log(job, 'warn', `Network/proxy error — rotating proxy: ${message.slice(0, 120)}`);
        }
      }
      throw lastError ?? new CheckoutError('All proxies failed', 'proxy_error');
    } catch (err) {
      await this.handleJobError(job, err, proxyUsed);
    } finally {
      this.jobContext.delete(job.id);
      this.abortControllers.delete(job.id);
      this.releaseSlot();
    }
  }

  private async executeJobHttp(
    job: Job,
    session: HttpSession,
    account: { email: string; password: string },
    proxy: ReturnType<ProxyPool['at']>,
    signal: AbortSignal,
  ): Promise<void> {
    const saleAt = job.testMode ? null : job.saleTime ? parseJstSaleTime(job.saleTime) : null;

    if (saleAt) {
      const preLoginMs = randomPreLoginMs(
        this.config.preLoginMinMinutes,
        this.config.preLoginMaxMinutes,
      );
      const preLoginAt = new Date(saleAt.getTime() - preLoginMs);
      const waitMs = preLoginAt.getTime() - Date.now();
      if (waitMs > 0) {
        job.status = 'waiting';
        this.log(job, 'info', `Waiting until pre-login at ${preLoginAt.toISOString()}`);
        await sleep(waitMs, signal).catch(() => {
          if (job.cancelRequested) throw new Error('cancelled');
        });
      }
    }

    if (job.cancelRequested) return;

    await this.httpCheckout.login(session, account, proxy, (msg) => this.log(job, 'info', msg));
    await this.httpCheckout.clearCart(session, (msg) => this.log(job, 'info', msg));

    if (job.mode === 'normal') {
      await this.runNormalModeHttp(job, session, account, proxy, signal);
    } else {
      await this.runMonitorModeHttp(job, session, account, proxy, signal);
    }
  }

  private async runNormalModeHttp(
    job: Job,
    session: HttpSession,
    account: { email: string; password: string },
    proxy: ReturnType<ProxyPool['at']>,
    signal: AbortSignal,
  ): Promise<void> {
    const saleAt = job.testMode ? null : job.saleTime ? parseJstSaleTime(job.saleTime) : null;
    if (saleAt) {
      const waitMs = saleAt.getTime() - Date.now();
      if (waitMs > 0) {
        job.status = 'waiting';
        this.log(job, 'info', `Waiting for sale at ${saleAt.toISOString()}`);
        await sleep(waitMs, signal).catch(() => {
          if (job.cancelRequested) throw new Error('cancelled');
        });
      }
    }

    if (job.cancelRequested) return;
    job.status = 'running';

    const productUrl = job.productUrls[0];
    const outcome = await this.httpCheckout.checkout(session, account, productUrl, proxy, (msg) =>
      this.log(job, 'info', msg),
    );

    await this.completeJobSuccess(job, productUrl, outcome.orderId, outcome.durationMs, proxy);
  }

  private async runMonitorModeHttp(
    job: Job,
    session: HttpSession,
    account: { email: string; password: string },
    proxy: ReturnType<ProxyPool['at']>,
    signal: AbortSignal,
  ): Promise<void> {
    job.status = 'running';

    if (job.testMode) {
      const url = job.productUrls[0];
      this.log(job, 'info', `Test mode: checkout now (${url})`);
      const outcome = await this.httpCheckout.checkout(session, account, url, proxy, (msg) =>
        this.log(job, 'info', msg),
      );
      await this.completeJobSuccess(job, url, outcome.orderId, outcome.durationMs, proxy);
      return;
    }

    let attempts = 0;
    const maxAttempts = 3600;

    while (!job.cancelRequested && !signal.aborted && attempts < maxAttempts) {
      for (const url of job.productUrls) {
        if (await this.httpCheckout.checkProductAvailable(session, url, proxy, (msg) => this.log(job, 'info', msg))) {
          this.log(job, 'info', `Product available: ${url}`);
          const outcome = await this.httpCheckout.checkout(session, account, url, proxy, (msg) =>
            this.log(job, 'info', msg),
          );
          await this.completeJobSuccess(job, url, outcome.orderId, outcome.durationMs, proxy);
          return;
        }
      }
      attempts += 1;
      this.log(job, 'info', `Monitor poll #${attempts} — not yet available`);
      await sleep(this.config.monitorPollIntervalMs, signal).catch(() => {
        if (job.cancelRequested) throw new Error('cancelled');
      });
    }
    throw new CheckoutError('Monitor timeout — product never became available', 'out_of_stock');
  }

  private async completeJobSuccess(
    job: Job,
    productUrl: string,
    orderId: string | undefined,
    durationMs: number,
    proxy?: { host: string; port: number },
  ): Promise<void> {
    job.status = 'completed';
    job.completedAt = now();
    job.result = { success: true, orderId, durationMs };

    await this.discordForJob(job.id)
      .report({
        success: true,
        jobId: job.id,
        mode: job.mode,
        account: job.accountEmail,
        productUrl,
        orderId,
        durationMs,
        proxy: proxy ? `${proxy.host}:${proxy.port}` : undefined,
        timestamp: now(),
      })
      .catch((err) => this.log(job, 'warn', `Discord report failed: ${err}`));
  }

  private async handleJobError(
    job: Job,
    err: unknown,
    proxy?: { host: string; port: number },
  ): Promise<void> {
    if (job.cancelRequested || (err instanceof Error && err.message === 'cancelled')) {
      job.status = 'cancelled';
      this.log(job, 'warn', 'Job cancelled');
      return;
    }

    const { category, message } = categorizeError(err);
    job.status = 'failed';
    job.completedAt = now();
    job.result = { success: false, errorCategory: category, errorMessage: message };
    this.log(job, 'error', message);

    const logTail = job.logs
      .slice(-15)
      .map((l) => `[${l.timestamp.slice(11, 19)}] ${l.message}`)
      .join('\n');

    await this.discordForJob(job.id)
      .report({
        success: false,
        jobId: job.id,
        mode: job.mode,
        account: job.accountEmail,
        productUrl: job.productUrls[0] ?? '',
        errorCategory: category,
        errorMessage: message,
        logTail: logTail || undefined,
        durationMs: Date.now() - new Date(job.startedAt ?? job.createdAt).getTime(),
        proxy: proxy ? `${proxy.host}:${proxy.port}` : undefined,
        timestamp: now(),
      })
      .catch(() => {});
  }

  private async runJobBrowser(job: Job, accountIndex: number): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(job.id, controller);

    await this.acquireSlot();
    let session: Awaited<ReturnType<BrowserPool['createSession']>> | undefined;
    const maxProxyAttempts = Math.max(this.proxyPool.count, 1);

    try {
      if (job.cancelRequested) return;

      job.status = 'pre_login';
      job.startedAt = now();
      this.log(job, 'info', `Starting job (mode=${job.mode}, account=${job.accountEmail})`);

      let lastError: unknown;

      for (let attempt = 0; attempt < maxProxyAttempts; attempt++) {
        if (session) {
          await this.browserPool.closeSession(session);
          session = undefined;
        }

        const proxyIndex = accountIndex + attempt;
        session = await this.browserPool.createSession(
          this.config.accounts[accountIndex],
          accountIndex,
          proxyIndex,
        );

        if (session.proxy) {
          job.proxyHost = session.proxy.host;
          this.log(
            job,
            'info',
            `Using proxy ${session.proxy.host}:${session.proxy.port} (attempt ${attempt + 1}/${maxProxyAttempts})`,
          );
        }

        try {
          await this.executeJob(job, session, controller.signal);
          return;
        } catch (err) {
          lastError = err;
          if (job.cancelRequested || (err instanceof Error && err.message === 'cancelled')) {
            throw err;
          }
          if (!isRetryableNetworkError(err) || attempt === maxProxyAttempts - 1) {
            throw err;
          }
          const message = err instanceof Error ? err.message : String(err);
          this.log(job, 'warn', `Network/proxy error — rotating proxy: ${message.slice(0, 120)}`);
        }
      }

      throw lastError ?? new CheckoutError('All proxies failed', 'proxy_error');
    } catch (err) {
      await this.handleJobError(job, err, session?.proxy);
    } finally {
      if (session) await this.browserPool.closeSession(session);
      this.jobContext.delete(job.id);
      this.abortControllers.delete(job.id);
      this.releaseSlot();
    }
  }

  private async executeJob(
    job: Job,
    session: Awaited<ReturnType<BrowserPool['createSession']>>,
    signal: AbortSignal,
  ): Promise<void> {
    const saleAt = job.testMode ? null : job.saleTime ? parseJstSaleTime(job.saleTime) : null;

    if (saleAt) {
      const preLoginMs = randomPreLoginMs(
        this.config.preLoginMinMinutes,
        this.config.preLoginMaxMinutes,
      );
      const preLoginAt = new Date(saleAt.getTime() - preLoginMs);
      const waitMs = preLoginAt.getTime() - Date.now();

      if (waitMs > 0) {
        job.status = 'waiting';
        this.log(job, 'info', `Waiting until pre-login at ${preLoginAt.toISOString()}`);
        await sleep(waitMs, signal).catch(() => {
          if (job.cancelRequested) throw new Error('cancelled');
        });
      }
    }

    if (job.cancelRequested) return;

    await this.automation.login(session, (msg) => this.log(job, 'info', msg));
    await this.automation.clearCart(session, (msg) => this.log(job, 'info', msg));
    const hasSavedCard = await this.automation.verifyPaymentCard(session, (msg) =>
      this.log(job, 'info', msg),
    );

    if (job.mode === 'normal') {
      await this.runNormalMode(job, session, hasSavedCard, signal);
    } else {
      await this.runMonitorMode(job, session, hasSavedCard, signal);
    }
  }

  private async runNormalMode(
    job: Job,
    session: Awaited<ReturnType<BrowserPool['createSession']>>,
    hasSavedCard: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const saleAt = job.testMode ? null : job.saleTime ? parseJstSaleTime(job.saleTime) : null;

    if (saleAt) {
      const waitMs = saleAt.getTime() - Date.now();
      if (waitMs > 0) {
        job.status = 'waiting';
        this.log(job, 'info', `Waiting for sale at ${saleAt.toISOString()}`);
        await sleep(waitMs, signal).catch(() => {
          if (job.cancelRequested) throw new Error('cancelled');
        });
      }
    }

    if (job.cancelRequested) return;
    job.status = 'running';

    const productUrl = job.productUrls[0];
    const outcome = await this.automation.addToCartAndCheckout(
      session,
      productUrl,
      (msg) => this.log(job, 'info', msg),
      hasSavedCard,
    );

    job.status = 'completed';
    job.completedAt = now();
    job.result = {
      success: true,
      orderId: outcome.orderId,
      durationMs: outcome.durationMs,
    };

    await this.discordForJob(job.id)
      .report({
        success: true,
        jobId: job.id,
        mode: job.mode,
        account: job.accountEmail,
        productUrl,
        orderId: outcome.orderId,
        durationMs: outcome.durationMs,
        proxy: session.proxy ? `${session.proxy.host}:${session.proxy.port}` : undefined,
        timestamp: now(),
      })
      .catch((err) => this.log(job, 'warn', `Discord report failed: ${err}`));
  }

  private async runMonitorMode(
    job: Job,
    session: Awaited<ReturnType<BrowserPool['createSession']>>,
    hasSavedCard: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    job.status = 'running';

    if (job.testMode) {
      const url = job.productUrls[0];
      this.log(job, 'info', `Test mode: checkout now (${url})`);
      await this.completeCheckout(job, session, url, hasSavedCard);
      return;
    }

    const { page } = session;
    const maxAttempts = 3600;
    let attempts = 0;

    while (!job.cancelRequested && !signal.aborted && attempts < maxAttempts) {
      for (const url of job.productUrls) {
        if (await this.automation.isProductAvailable(page, url, (msg) => this.log(job, 'info', msg))) {
          this.log(job, 'info', `Product available: ${url}`);
          await this.completeCheckout(job, session, url, hasSavedCard);
          return;
        }
      }

      attempts += 1;
      this.log(job, 'info', `Monitor poll #${attempts} — not yet available`);
      await sleep(this.config.monitorPollIntervalMs, signal).catch(() => {
        if (job.cancelRequested) throw new Error('cancelled');
      });
    }

    throw new CheckoutError('Monitor timeout — product never became available', 'out_of_stock');
  }

  private async completeCheckout(
    job: Job,
    session: Awaited<ReturnType<BrowserPool['createSession']>>,
    productUrl: string,
    hasSavedCard: boolean,
  ): Promise<void> {
    const outcome = await this.automation.addToCartAndCheckout(
      session,
      productUrl,
      (msg) => this.log(job, 'info', msg),
      hasSavedCard,
    );

    job.status = 'completed';
    job.completedAt = now();
    job.result = {
      success: true,
      orderId: outcome.orderId,
      durationMs: outcome.durationMs,
    };

    await this.discordForJob(job.id)
      .report({
        success: true,
        jobId: job.id,
        mode: job.mode,
        account: job.accountEmail,
        productUrl,
        orderId: outcome.orderId,
        durationMs: outcome.durationMs,
        proxy: session.proxy ? `${session.proxy.host}:${session.proxy.port}` : undefined,
        timestamp: now(),
      })
      .catch((err) => this.log(job, 'warn', `Discord report failed: ${err}`));
  }
}
