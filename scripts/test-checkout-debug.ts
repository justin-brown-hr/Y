/**
 * Debug checkout flow — saves HTML snapshots at each step.
 * Run: npx tsx scripts/test-checkout-debug.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ override: true });

import { loadConfig, parseProxyEntry } from '../src/config.js';
import { HttpSession } from '../src/http/http-session.js';
import { API } from '../src/http/constants.js';
import { loginWithRealBrowser } from '../src/http/login-browser.js';
import { parseOrderCompletePage } from '../src/http/order-verify.js';
import * as cheerio from 'cheerio';

const OUT = join(process.cwd(), 'debug-checkout');
const PRODUCT = process.env.TEST_PRODUCT_URL ?? 'https://www.yodobashi.com/product/100000001003891482/';

function save(name: string, html: string, url: string) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.html`), `<!-- url: ${url} -->\n${html}`, 'utf8');
  const title = cheerio.load(html)('title').text().trim();
  console.log(`  saved ${name}.html title="${title}" len=${html.length}`);
}

function parseFormFields(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $('form input, form select, form textarea').each((_, el) => {
    const name = $(el).attr('name');
    if (!name) return;
    const type = ($(el).attr('type') ?? '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image') return;
    if (type === 'checkbox' || type === 'radio') {
      if (!$(el).attr('checked')) return;
    }
    fields[name] = $(el).val()?.toString() ?? $(el).attr('value') ?? '';
  });
  return fields;
}

function extractNodeStateKey(url: string): string | undefined {
  return url.match(/nodeStateKey=([^&]+)/)?.[1];
}

async function main() {
  const config = loadConfig();
  const email = config.accounts[0]?.email;
  const password = config.accounts[0]?.password;
  const proxy = config.proxies[0];
  if (!email || !password) throw new Error('ACCOUNTS required');

  console.log(`Account: ${email}`);
  console.log(`Product: ${PRODUCT}`);
  console.log(`SECURITY_CODE: ${config.securityCode ? 'set' : 'NOT SET'}`);
  console.log(`Output: ${OUT}\n`);

  const session = new HttpSession(proxy, config.navigationTimeoutMs, config.httpUseProxy);
  await loginWithRealBrowser(session, { email, password }, proxy, config, console.log);
  await session.get(API.memberIndex);

  const productRes = await session.get(PRODUCT);
  save('01-product', String(productRes.data), productRes.url);

  const { YodobashiHttpCheckout } = await import('../src/http/checkout.js');
  const checkout = new YodobashiHttpCheckout(config);

  try {
    await checkout.clearCart(session, console.log);
  } catch (e) {
    console.log('clearCart:', e);
  }

  // Manual trace through order flow
  const { buildAddCartPayload, parseProductHtml } = await import('../src/http/product.js');
  const productId = PRODUCT.match(/(\d{10,})/)?.[1] ?? '';
  const parsed = parseProductHtml(String(productRes.data), productId, PRODUCT);
  console.log('inStock:', parsed.inStock, 'fields:', Object.keys(parsed.fields).length);

  const addRes = await session.postForm(API.cartAdd, buildAddCartPayload(parsed), PRODUCT);
  save('02-cart-add', String(addRes.data), addRes.url);

  const cartRes = await session.get(API.cartNext, addRes.url);
  save('03-cart', String(cartRes.data), cartRes.url);

  const orderRes = await session.get(API.orderIndex, API.cartNext);
  let currentUrl = orderRes.url;
  save('04-order-index', String(orderRes.data), currentUrl);

  let nodeStateKey = extractNodeStateKey(currentUrl);
  if (!nodeStateKey) {
    const retry = await session.get(API.orderIndex, API.cartNext);
    currentUrl = retry.url;
    nodeStateKey = extractNodeStateKey(currentUrl);
    save('04b-order-index-retry', String(retry.data), currentUrl);
  }
  console.log('nodeStateKey:', nodeStateKey);

  if (currentUrl.includes('reinputcredit') && nodeStateKey) {
    const reinputHtml = String((await session.get(currentUrl)).data);
    save('05-reinput', reinputHtml, currentUrl);
  }

  const confirmUrl = `${API.orderConfirm}${nodeStateKey}`;
  const confirmHtml = String((await session.get(confirmUrl, API.orderIndex)).data);
  save('06-confirm', confirmHtml, confirmUrl);

  await session.get(API.orderDeliveryChange, confirmUrl);
  const confirmFields = parseFormFields(confirmHtml);
  console.log('confirm fields:', Object.keys(confirmFields).length);

  const postConfirmRes = await session.postForm(API.orderConfirmAction, confirmFields, confirmUrl);
  const paymentUrl = postConfirmRes.url;
  const paymentKey = extractNodeStateKey(paymentUrl) ?? nodeStateKey!;
  save('07-post-confirm', String(postConfirmRes.data), paymentUrl);
  console.log('paymentUrl:', paymentUrl);

  const paymentHtml = String((await session.get(`${API.orderPayment}${paymentKey}`, confirmUrl)).data);
  save('08-payment', paymentHtml, `${API.orderPayment}${paymentKey}`);

  const paymentFields = parseFormFields(paymentHtml);
  console.log('payment fields:', Object.keys(paymentFields));
  console.log('needs CVV field:', 'creditCard.securityCode' in paymentFields);
  if (paymentFields['creditCard.securityCode'] && config.securityCode) {
    paymentFields['creditCard.securityCode'] = config.securityCode;
  }

  const paymentPostRes = await session.postForm(
    API.orderPaymentAction,
    paymentFields,
    `${API.orderPayment}${paymentKey}`,
  );
  save('09-payment-post', String(paymentPostRes.data), paymentPostRes.url);
  console.log('paymentPost url:', paymentPostRes.url);

  const postParse = parseOrderCompletePage(String(paymentPostRes.data), paymentPostRes.url);
  console.log('payment post parse:', postParse);

  const completeKey = extractNodeStateKey(paymentPostRes.url) ?? paymentKey;
  const completeRes = await session.get(`${API.orderComplete}${completeKey}`, paymentPostRes.url);
  save('10-complete', String(completeRes.data), completeRes.url);
  console.log('complete url:', completeRes.url);

  const completeParse = parseOrderCompletePage(String(completeRes.data), completeRes.url);
  console.log('complete parse:', completeParse);

  const historyRes = await session.get(API.orderHistory);
  save('11-history', String(historyRes.data), historyRes.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
