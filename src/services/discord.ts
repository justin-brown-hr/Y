import type { ErrorCategory } from '../utils/errors.js';

export interface WebhookPayload {
  success: boolean;
  jobId: string;
  mode: 'normal' | 'monitor';
  account: string;
  productUrl: string;
  orderId?: string;
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  durationMs: number;
  proxy?: string;
  timestamp: string;
  /** Last job log lines (failures only) */
  logTail?: string;
}

export class DiscordReporter {
  constructor(private readonly webhookUrl: string) {}

  get enabled(): boolean {
    return Boolean(this.webhookUrl);
  }

  async report(payload: WebhookPayload): Promise<void> {
    if (!this.webhookUrl) return;

    const color = payload.success ? 0x00c853 : 0xff1744;
    const title = payload.success ? 'Checkout Success' : 'Checkout Failed';

    const fields = [
      { name: 'Job ID', value: payload.jobId, inline: true },
      { name: 'Mode', value: payload.mode, inline: true },
      { name: 'Account', value: payload.account, inline: true },
      { name: 'Product', value: payload.productUrl, inline: false },
      { name: 'Duration', value: `${payload.durationMs}ms`, inline: true },
    ];

    if (payload.orderId) {
      fields.push({ name: 'Order ID', value: payload.orderId, inline: true });
    }
    if (payload.proxy) {
      fields.push({ name: 'Proxy', value: payload.proxy, inline: true });
    }
    if (payload.errorCategory) {
      fields.push({ name: 'Error Category', value: payload.errorCategory, inline: true });
    }
    if (payload.errorMessage) {
      fields.push({ name: 'Error', value: payload.errorMessage.slice(0, 1000), inline: false });
    }
    if (payload.logTail) {
      fields.push({ name: 'Logs', value: payload.logTail.slice(0, 1000), inline: false });
    }

    const body = {
      embeds: [
        {
          title,
          color,
          fields,
          timestamp: payload.timestamp,
        },
      ],
    };

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord webhook failed (${res.status}): ${text}`);
    }
  }
}
