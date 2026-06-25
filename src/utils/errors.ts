export type ErrorCategory =
  | 'out_of_stock'
  | 'payment_declined'
  | 'proxy_timeout'
  | 'proxy_error'
  | 'login_failed'
  | 'captcha_blocked'
  | 'product_not_found'
  | 'cart_error'
  | 'checkout_timeout'
  | 'network_error'
  | 'unknown';

export class CheckoutError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;

  constructor(message: string, category: ErrorCategory, retryable = false) {
    super(message);
    this.name = 'CheckoutError';
    this.category = category;
    this.retryable = retryable;
  }
}

export function categorizeError(err: unknown): { category: ErrorCategory; message: string } {
  if (err instanceof CheckoutError) {
    return { category: err.category, message: err.message };
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('captcha') || lower.includes('recaptcha')) {
    return { category: 'captcha_blocked', message };
  }
  if (
    lower.includes('net::') ||
    lower.includes('http2_protocol') ||
    lower.includes('err_http2') ||
    lower.includes('econnrefused') ||
    lower.includes('err_tunnel') ||
    lower.includes('err_connection')
  ) {
    return { category: 'proxy_error', message };
  }
  if (lower.includes('proxy') && (lower.includes('timeout') || lower.includes('timed out'))) {
    return { category: 'proxy_timeout', message };
  }
  if (lower.includes('proxy')) {
    return { category: 'proxy_error', message };
  }
  if (lower.includes('在庫') || lower.includes('out of stock') || lower.includes('sold out')) {
    return { category: 'out_of_stock', message };
  }
  if (lower.includes('payment') || lower.includes('declined') || lower.includes('カード')) {
    return { category: 'payment_declined', message };
  }
  if (
    lower.includes('login failed') ||
    lower.includes('credentials') ||
    lower.includes('ログインに失敗') ||
    lower.includes('memberid')
  ) {
    return { category: 'login_failed', message };
  }
  if (lower.includes('timeout') || lower.includes('navigation failed')) {
    return { category: 'checkout_timeout', message };
  }
  if (lower.includes('network')) {
    return { category: 'network_error', message };
  }

  return { category: 'unknown', message };
}
