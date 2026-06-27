export interface Account {
  email: string;
  password: string;
}

export interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface AppConfig {
  apiToken: string;
  port: number;
  host: string;
  discordWebhookUrl: string;
  accounts: Account[];
  proxies: ProxyConfig[];
  defaultSaleTime: string;
  preLoginMinMinutes: number;
  preLoginMaxMinutes: number;
  maxParallelJobs: number;
  headless: boolean;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  monitorPollIntervalMs: number;
  securityCode?: string;
  checkoutEngine: 'http' | 'browser';
  httpUseProxy: boolean;
  browserUseProxy: boolean;
}

function parseAccounts(raw: string): Account[] {
  if (!raw.trim()) return [];
  return raw.split(',').map((entry) => {
    const sep = entry.indexOf(':');
    if (sep === -1) throw new Error(`Invalid account format: ${entry}`);
    return {
      email: entry.slice(0, sep).trim(),
      password: entry.slice(sep + 1).trim(),
    };
  });
}

export function parseProxyEntry(entry: string): ProxyConfig {
  const parts = entry.trim().split(':');
  if (parts.length !== 4) {
    throw new Error(`Invalid proxy format: ${entry}. Expected host:port:username:password`);
  }
  const [host, port, username, password] = parts;
  return { host, port: Number(port), username, password };
}

function parseProxies(raw: string): ProxyConfig[] {
  if (!raw.trim()) return [];
  return raw.split(',').map((entry) => parseProxyEntry(entry));
}

export function loadConfig(): AppConfig {
  const apiToken = process.env.API_TOKEN;
  if (!apiToken) throw new Error('API_TOKEN is required');

  return {
    apiToken,
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
    accounts: parseAccounts(process.env.ACCOUNTS ?? ''),
    proxies: parseProxies(process.env.PROXIES ?? ''),
    defaultSaleTime: process.env.DEFAULT_SALE_TIME ?? '09:30:00',
    preLoginMinMinutes: Number(process.env.PRE_LOGIN_MIN_MINUTES ?? 5),
    preLoginMaxMinutes: Number(process.env.PRE_LOGIN_MAX_MINUTES ?? 10),
    maxParallelJobs: Number(process.env.MAX_PARALLEL_JOBS ?? 50),
    headless: process.env.HEADLESS !== 'false',
    navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS ?? 15000),
    actionTimeoutMs: Number(process.env.ACTION_TIMEOUT_MS ?? 8000),
    monitorPollIntervalMs: Number(process.env.MONITOR_POLL_INTERVAL_MS ?? 500),
    securityCode: process.env.SECURITY_CODE || undefined,
    checkoutEngine: process.env.CHECKOUT_ENGINE === 'browser' ? 'browser' : 'http',
    httpUseProxy: process.env.HTTP_USE_PROXY !== 'false',
    browserUseProxy: process.env.BROWSER_USE_PROXY !== 'false',
  };
}

export function productUrlFromInput(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, '');
  if (trimmed.startsWith('http')) return trimmed;
  const code = trimmed.replace(/\D/g, '');
  if (!code) throw new Error('Invalid product URL or product code');
  return `https://www.yodobashi.com/product/${code}/`;
}

/** Parse "HH:MM:SS" JST sale time into today's Date in JST. */
export function parseJstSaleTime(timeStr: string, reference = new Date()): Date {
  const [h, m, s] = timeStr.split(':').map(Number);
  if ([h, m, s].some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid sale time format: ${timeStr}. Expected HH:MM:SS`);
  }

  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const utcMs = reference.getTime();
  const jstNow = new Date(utcMs + jstOffsetMs);

  const saleJst = new Date(
    Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate(), h, m, s),
  );

  if (saleJst.getTime() <= jstNow.getTime()) {
    saleJst.setUTCDate(saleJst.getUTCDate() + 1);
  }

  return new Date(saleJst.getTime() - jstOffsetMs);
}

export function randomPreLoginMs(minMinutes: number, maxMinutes: number): number {
  const min = minMinutes * 60 * 1000;
  const max = maxMinutes * 60 * 1000;
  return min + Math.random() * (max - min);
}
