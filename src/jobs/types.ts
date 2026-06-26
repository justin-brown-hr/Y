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
  accountEmail: string;
  proxyHost?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  logs: JobLogEntry[];
  result?: JobResult;
  cancelRequested: boolean;
}

export interface StartJobRequest {
  mode: JobMode;
  productUrl?: string;
  productUrls?: string[];
  productCode?: string;
  saleTime?: string;
  accountIndex?: number;
  /** Override .env account for this job */
  accountEmail?: string;
  accountPassword?: string;
  /** Override .env proxy: host:port:username:password */
  proxy?: string;
  /** Override .env Discord webhook for this job */
  discordWebhookUrl?: string;
}

export interface JobRuntimeContext {
  account: { email: string; password: string };
  proxy?: { host: string; port: number; username: string; password: string };
  discordWebhookUrl?: string;
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
