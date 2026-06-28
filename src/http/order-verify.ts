/** Detect real Yodobashi order-complete page content (not URL alone). */
export function parseOrderCompletePage(
  html: string,
  url: string,
): { ok: true; orderId: string } | { ok: false; reason: string } {
  const hasThanks =
    html.includes('ご注文ありがとうございました') || html.includes('ご注文ありがとう');

  const orderId =
    html.match(/注文番号[：:\s]*([0-9]{8,})/)?.[1] ??
    html.match(/注文番号[：:\s]*([A-Z0-9-]{8,})/i)?.[1];

  if (html.includes('在庫がありません') || html.includes('売り切れ')) {
    return { ok: false, reason: 'Out of stock at checkout' };
  }

  if (
    (html.includes('決済') && html.includes('できません')) ||
    html.includes('決済エラー') ||
    html.includes('カード情報に誤り') ||
    html.includes('セキュリティコード') ||
    html.includes('reinputcredit')
  ) {
    return { ok: false, reason: 'Payment declined or CVV required' };
  }

  if (html.includes('ログイン') && html.includes('memberId') && !hasThanks) {
    return { ok: false, reason: 'Session expired — login required' };
  }

  if (hasThanks && orderId) {
    return { ok: true, orderId };
  }

  if (hasThanks && !orderId) {
    return { ok: false, reason: 'Thank-you page without order number — order not confirmed' };
  }

  if (url.includes('/order/complete/')) {
    return {
      ok: false,
      reason: 'Complete URL reached but page is not an order confirmation (no ご注文ありがとう)',
    };
  }

  return { ok: false, reason: 'Checkout did not reach order confirmation page' };
}

export function orderIdInHistory(html: string, orderId: string): boolean {
  return html.includes(orderId);
}
