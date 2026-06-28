/** Detect real Yodobashi order-complete page content (not URL alone). */
const THANKS_MARKERS = [
  'ご注文ありがとうございました',
  'ご注文ありがとう',
  'ご注文手続き完了',
  '注文手続き完了',
  'ご注文が完了',
  'ご購入ありがとう',
];

export function extractOrderIdFromHtml(html: string): string | undefined {
  const patterns = [
    /(?:ご)?注文番号[：:\s<>/]*([0-9]{10})/,
    /(?:ご)?注文番号[：:\s<>/]*([0-9]{8,14})/,
    /orderNo["'\s:=]+([0-9]{10})/i,
    /orderNumber["'\s:=]+([0-9]{10})/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return undefined;
}

export function hasOrderThanksText(html: string): boolean {
  if (THANKS_MARKERS.some((m) => html.includes(m))) return true;
  if (/orderComplete|completeBox|order-complete/i.test(html)) return true;
  return false;
}

export function pageTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim() ?? '';
}

export function parseOrderCompletePage(
  html: string,
  url: string,
): { ok: true; orderId: string } | { ok: false; reason: string; hint?: string } {
  const orderId = extractOrderIdFromHtml(html);
  const hasThanks = hasOrderThanksText(html);
  const title = pageTitle(html);

  if (html.includes('在庫がありません') || html.includes('売り切れ')) {
    return { ok: false, reason: 'Out of stock at checkout' };
  }

  if (
    html.includes('セキュリティコード') ||
    url.includes('reinputcredit') ||
    html.includes('カード情報に誤り')
  ) {
    return {
      ok: false,
      reason: 'CVV/security code required or card error',
      hint: 'Set SECURITY_CODE in .env or CVV on the account profile',
    };
  }

  if (
    html.includes('決済エラー') ||
    (html.includes('決済') && html.includes('できません'))
  ) {
    return { ok: false, reason: 'Payment declined' };
  }

  if (
    (html.includes('memberId') || title.includes('ログイン')) &&
    !hasThanks &&
    !orderId
  ) {
    return { ok: false, reason: 'Session expired — login required' };
  }

  if (hasThanks && orderId) {
    return { ok: true, orderId };
  }

  if (orderId && url.includes('/order/complete/')) {
    return { ok: true, orderId };
  }

  if (hasThanks && !orderId) {
    return { ok: false, reason: 'Thank-you page without order number — order not confirmed' };
  }

  if (url.includes('/order/complete/')) {
    return {
      ok: false,
      reason: 'Reached order complete URL but payment did not finish',
      hint:
        'Usually missing CVV (SECURITY_CODE in .env) or card not saved on Yodobashi account. ' +
        `Page title: "${title || 'unknown'}"`,
    };
  }

  return { ok: false, reason: 'Checkout did not reach order confirmation page' };
}

/** Pull the most recent 10-digit order id from order history HTML. */
export function findLatestOrderIdInHistory(html: string): string | undefined {
  const labeled = html.match(/(?:ご)?注文番号[：:\s<>/]*([0-9]{10})/g);
  if (labeled?.length) {
    const last = labeled[labeled.length - 1].match(/([0-9]{10})/);
    if (last?.[1]) return last[1];
  }

  const rows = [...html.matchAll(/\b([0-9]{10})\b/g)].map((m) => m[1]);
  return rows[0];
}

export function orderIdInHistory(html: string, orderId: string): boolean {
  return html.includes(orderId);
}
