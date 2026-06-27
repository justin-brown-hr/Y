export type JobMode = 'normal' | 'monitor';
export type JobStatus = 'pending' | 'pre_login' | 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface JobResult {
  success: boolean;
  orderId?: string;
  errorCategory?: string;
  errorMessage?: string;
  durationMs?: number;
}

export interface Job {
  id: string;
  mode: JobMode;
  status: JobStatus;
  productUrls: string[];
  saleTime?: string;
  /** JST HH:MM:SS — when to log in (overrides random pre-login window) */
  loginTime?: string;
  /** Extra seconds added to login time (stagger multi-account starts) */
  loginDelaySec?: number;
  accountEmail: string;
  proxyHost?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  logs: JobLogEntry[];
  result?: JobResult;
  cancelRequested: boolean;
  /** Run immediately — skip sale/pre-login waits */
  testMode?: boolean;
  monitorPollIntervalMs?: number;
}

export interface StartJobRequest {
  mode: JobMode;
  productUrl?: string;
  productUrls?: string[];
  productCode?: string;
  saleTime?: string;
  /** JST HH:MM:SS — fixed login time per account */
  loginTime?: string;
  /** Seconds added on top of loginTime (bulk stagger) */
  loginDelaySec?: number;
  /** Minutes between accounts when starting allAccounts (converted to loginDelaySec per index) */
  loginStaggerMinutes?: number;
  accountIndex?: number;
  /** Skip all timing waits; login + checkout now */
  testMode?: boolean;
  /** Override .env account for this job */
  accountEmail?: string;
  accountPassword?: string;
  /** Override .env proxy: host:port:username:password */
  proxy?: string;
  /** Per-job CVV when Yodobashi asks for security code */
  securityCode?: string;
  /** Monitor poll interval override (ms) */
  monitorPollIntervalMs?: number;
  /** Override .env Discord webhook for this job */
  discordWebhookUrl?: string;
}

export interface JobRuntimeContext {
  account: { email: string; password: string };
  proxy?: { host: string; port: number; username: string; password: string };
  discordWebhookUrl?: string;
  securityCode?: string;
  monitorPollIntervalMs?: number;
}

export interface JobSummary {
  id: string;
  mode: JobMode;
  status: JobStatus;
  productUrls: string[];
  accountEmail: string;
  createdAt: string;
  result?: JobResult;
}
