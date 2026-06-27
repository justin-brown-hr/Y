import * as cheerio from 'cheerio';
import { API, BASE_ORDER, BASE_WWW } from './constants.js';
import type { HttpSession } from './http-session.js';
import { loginWithRealBrowser } from './login-browser.js';
import { loginWithHttp } from './login-http.js';
import { parseProductHtml, productUrls, buildAddCartPayload, type ProductFields } from './product.js';
import { fetchProductHtmlWithBrowser } from './login-browser.js';
import type { Account, AppConfig, ProxyConfig } from '../config.js';
import { CheckoutError } from '../utils/errors.js';
import { resolveYodobashiUrl, normalizeProductUrl } from './url-utils.js';

export interface HttpCheckoutResult {
  success: boolean;
  orderId?: string;
  durationMs: number;
}

function extractNodeStateKey(url: string): string | undefined {
  const match = url.match(/nodeStateKey=([^&]+)/);
  return match?.[1];
}

function parseFormFields(html: string, selector = 'form'): Record<string, string> {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $(`${selector} input, ${selector} select, ${selector} textarea`).each((_, el) => {
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

export class YodobashiHttpCheckout {
  constructor(private readonly config: AppConfig) {}

  private async loadProduct(
    session: HttpSession,
    productUrl: string,
    proxy: ProxyConfig | undefined,
    log: (msg: string) => void,
  ): Promise<ProductFields> {
    const urls = productUrl.startsWith('http') ? [productUrl] : productUrls(productUrl.replace(/\D/g, ''));

    if (this.config.httpUseProxy) {
      const { fetchProduct } = await import('./product.js');
      return fetchProduct(session, urls[0], log);
    }

    for (const url of urls) {
      try {
        const res = await session.get(url);
        if (res.status < 400 && res.data.length > 500) {
          const productId = url.match(/(\d{10,})/)?.[1] ?? '';
          const parsed = parseProductHtml(res.data, productId, url);
          parsed.inStock = parsed.stockStatusCode ? ['1', '2', '3', '4', '5'].includes(parsed.stockStatusCode) : /cartInSKU|js_buyBox/.test(res.data);
          if (Object.keys(parsed.fields).length >= 3) return parsed;
        }
      } catch {
        // try browser
      }
    }

    log('HTTP product fetch failed — using browser (refer method)');
    const html = await fetchProductHtmlWithBrowser(urls[0], proxy, this.config, log);
    const productId = urls[0].match(/(\d{10,})/)?.[1] ?? '';
    const parsed = parseProductHtml(html, productId, urls[0]);
    parsed.inStock = /cartInSKU|js_buyBox/.test(html) && !/在庫がありません|売り切れ/.test(html);
    return parsed;
  }

  async login(
    session: HttpSession,
    account: Account,
    proxy: ProxyConfig | undefined,
    log: (msg: string) => void,
  ): Promise<void> {
    log('getGoYodoHome');
    try {
      await session.get(BASE_WWW);
    } catch (err) {
      log(`getGoYodoHome warning: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    }

    log('getAccessToken');
    try {
      await session.get(API.getAccessToken, BASE_WWW);
    } catch (err) {
      log(`getAccessToken warning: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    }

    try {
      await loginWithRealBrowser(session, account, proxy, this.config, log);
    } catch (browserErr) {
      const msg = browserErr instanceof Error ? browserErr.message.split('\n')[0] : String(browserErr);
      const category =
        browserErr instanceof CheckoutError ? browserErr.category : 'login_failed';
      log(`Browser login failed [${category}]: ${msg}`);
      log('Fallback: trying HTTP login');
      try {
        await loginWithHttp(session, account, log);
      } catch (httpErr) {
        const httpMsg = httpErr instanceof Error ? httpErr.message.split('\n')[0] : String(httpErr);
        log(`HTTP login also failed: ${httpMsg}`);
        throw browserErr instanceof CheckoutError ? browserErr : httpErr;
      }
    }

    log('callMemberIndex');
    await session.get(API.memberIndex, BASE_ORDER);
  }

  async clearCart(session: HttpSession, log: (msg: string) => void): Promise<void> {
    log('clearCart');
    const res = await session.get(API.cartClear, BASE_ORDER);
    const $ = cheerio.load(String(res.data));

    const deleteLinks = $('a')
      .filter((_, el) => {
        const cls = $(el).attr('class') ?? '';
        const text = $(el).text();
        return cls.includes('cartDelete') || cls.includes('js_cartDelete') || text.includes('削除');
      })
      .map((_, el) => $(el).attr('href'))
      .get()
      .filter(Boolean) as string[];

    if (deleteLinks.length === 0) {
      log('Cart empty — nothing to delete');
      return;
    }

    let removed = 0;
    for (const href of deleteLinks.slice(0, 20)) {
      const url = resolveYodobashiUrl(href, BASE_ORDER);
      if (!url) {
        log(`clearCart skip invalid link: ${href.slice(0, 80)}`);
        continue;
      }
      try {
        await session.get(url, API.cartClear);
        removed += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
        log(`clearCart delete warning: ${msg}`);
      }
    }

    log(`Cart cleared (${removed} item(s) removed)`);
  }

  async checkProductAvailable(
    session: HttpSession,
    productUrl: string,
    proxy: ProxyConfig | undefined,
    log: (msg: string) => void,
  ): Promise<boolean> {
    try {
      const product = await this.loadProduct(session, productUrl, proxy, log);
      return product.inStock === true;
    } catch {
      return false;
    }
  }

  async checkout(
    session: HttpSession,
    account: Account,
    productUrl: string,
    proxy: ProxyConfig | undefined,
    log: (msg: string) => void,
  ): Promise<HttpCheckoutResult> {
    const start = Date.now();
    const url = normalizeProductUrl(productUrl);

    log(`loadProduct ${url}`);
    const product = await this.loadProduct(session, url, proxy, log);
    if (!product.inStock) {
      throw new CheckoutError('Product out of stock', 'out_of_stock', true);
    }

    log('start callApiAddCart');
    const addRes = await session.postForm(API.cartAdd, buildAddCartPayload(product), product.productUrl);
    const addLocation = session.finalUrl(addRes);
    log(`callApiAddCart location ${addLocation}`);

    if (addRes.status >= 400 && !addLocation.includes('shoppingcart')) {
      throw new CheckoutError(`Add to cart failed HTTP ${addRes.status}`, 'cart_error');
    }

    log(`callNextCart ${account.email}`);
    const cartRes = await session.get(API.cartNext, addLocation || API.cartAdd);
    log(`callNextCart done: ${session.finalUrl(cartRes)}`);

    log(`callPayment ${account.email}`);
    const orderRes = await session.get(API.orderIndex, API.cartNext);
    let currentUrl = session.finalUrl(orderRes);
    log(`callPayment location: ${currentUrl}`);

    log(`callGetOrderIndex ${account.email}`);
    let nodeStateKey = extractNodeStateKey(currentUrl);
    if (!nodeStateKey) {
      const confirmRes = await session.get(API.orderIndex, API.cartNext);
      currentUrl = session.finalUrl(confirmRes);
      nodeStateKey = extractNodeStateKey(currentUrl);
    }
    log(`callGetOrderIndex: ${currentUrl}`);

    if (currentUrl.includes('reinputcredit') && nodeStateKey) {
      log('getReinputIndex');
      const reinputHtml = String((await session.get(currentUrl, API.orderIndex)).data);
      const reinputFields = parseFormFields(reinputHtml);
      if (this.config.securityCode) {
        reinputFields['creditCard.securityCode'] = this.config.securityCode;
      }
      log('callReinputCredit');
      await session.postForm(API.orderReinputAction, reinputFields, currentUrl);
      const afterReinput = await session.get(`${API.orderConfirm}${nodeStateKey}`, currentUrl);
      currentUrl = session.finalUrl(afterReinput);
      nodeStateKey = extractNodeStateKey(currentUrl) ?? nodeStateKey;
      log(`callOrderNext: ${currentUrl}`);
    }

    if (!nodeStateKey) {
      throw new CheckoutError('Missing nodeStateKey in order flow', 'checkout_timeout');
    }

    log(`start callGetConfirm ${account.email}`);
    const confirmUrl = currentUrl.includes('confirm')
      ? currentUrl
      : `${API.orderConfirm}${nodeStateKey}`;
    const confirmHtml = String((await session.get(confirmUrl, API.orderIndex)).data);

    log('start getDelivery');
    await session.get(API.orderDeliveryChange, confirmUrl);

    log(`start callPostConfirm ${account.email}`);
    const confirmFields = parseFormFields(confirmHtml);
    const postConfirmRes = await session.postForm(API.orderConfirmAction, confirmFields, confirmUrl);
    const paymentUrl = session.finalUrl(postConfirmRes);
    const paymentKey = extractNodeStateKey(paymentUrl) ?? nodeStateKey;

    log('start callPostPayment');
    const paymentHtml = String(
      (await session.get(`${API.orderPayment}${paymentKey}`, confirmUrl)).data,
    );
    const paymentFields = parseFormFields(paymentHtml);
    if (paymentFields['creditCard.securityCode'] && this.config.securityCode) {
      paymentFields['creditCard.securityCode'] = this.config.securityCode;
    }
    await session.postForm(API.orderPaymentAction, paymentFields, `${API.orderPayment}${paymentKey}`);

    log(`start callComplete ${account.email}`);
    const completeRes = await session.get(`${API.orderComplete}${paymentKey}`, API.orderPayment);
    const completeHtml = String(completeRes.data);
    const completeUrl = session.finalUrl(completeRes);

    if (!completeHtml.includes('ご注文ありがとう') && !completeUrl.includes('complete')) {
      if (completeHtml.includes('在庫')) {
        throw new CheckoutError('Out of stock at checkout', 'out_of_stock', true);
      }
      if (completeHtml.includes('カード') || completeHtml.includes('決済')) {
        throw new CheckoutError('Payment declined', 'payment_declined');
      }
      throw new CheckoutError('Checkout did not reach confirmation page', 'checkout_timeout');
    }

    const orderId =
      completeHtml.match(/注文番号[：:\s]*([A-Z0-9-]+)/i)?.[1] ??
      completeHtml.match(/(\d{10,})/)?.[1];

    log(`buy success ${account.email} true`);
    return { success: true, orderId, durationMs: Date.now() - start };
  }
}
