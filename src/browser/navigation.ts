import type { Page } from 'playwright';
import { CheckoutError } from '../utils/errors.js';

const RETRYABLE = /ERR_HTTP2|HTTP2_PROTOCOL|ERR_CONNECTION|ERR_TUNNEL|ERR_PROXY|ERR_TIMED_OUT|ERR_NETWORK|Timeout.*exceeded/i;

export async function safeGoto(
  page: Page,
  url: string,
  timeoutMs: number,
  log?: (msg: string) => void,
): Promise<void> {
  const strategies: Array<{ waitUntil: 'domcontentloaded' | 'commit'; label: string }> = [
    { waitUntil: 'domcontentloaded', label: 'domcontentloaded' },
    { waitUntil: 'commit', label: 'commit' },
  ];

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const strategy of strategies) {
      try {
        if (log && attempt > 0) log(`Retry navigation (${strategy.label}, attempt ${attempt + 1})`);
        await page.goto(url, { waitUntil: strategy.waitUntil, timeout: timeoutMs });
        return;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        if (!RETRYABLE.test(message)) throw err;
      }
    }
    await page.waitForTimeout(500);
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  if (RETRYABLE.test(message)) {
    throw new CheckoutError(
      `Cannot reach Yodobashi (${message.split('\n')[0]}). Check proxy is Japan-based and not blocked.`,
      'proxy_error',
      true,
    );
  }
  throw lastError;
}

export function isRetryableNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return RETRYABLE.test(message) || (err instanceof CheckoutError && err.retryable);
}
