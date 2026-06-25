import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Account, AppConfig } from '../config.js';
import type { ProxyConfig } from '../config.js';
import { ProxyPool } from '../services/proxy.js';
import { CheckoutError } from '../utils/errors.js';
import { safeGoto } from './navigation.js';

const URLS = {
  login: 'https://order.yodobashi.com/yc/login/index.html',
  cart: 'https://order.yodobashi.com/yc/shoppingcart/index.html',
  cartProceed: 'https://order.yodobashi.com/yc/shoppingcart/index.html?next=true',
} as const;

const SELECTORS = {
  memberId: '#memberId, input#memberId, input[name="memberId"]',
  password: '#password, input#password, input[name="password"]',
  loginButton: '#js_i_login0, button[type="submit"].loginBtn, input#js_i_login0',
  addToCart: '.yBtnText, #js_m_submitRelated, button:has-text("ショッピングカートに入れる")',
  buyBox: '#js_buyBox, .buyBox',
  cartProceed: '#sc_i_buy, a#sc_i_buy, button#sc_i_buy',
  cartItem: '.cartItemBlock, .cartItem, .js_cartItem',
  cartDelete: '.js_cartDelete, .cartDeleteBtn, a:has-text("削除")',
  securityCode: '#creditCard\\.securityCode, input[name="creditCard.securityCode"]',
  orderConfirm: '.btnRed.js_c_order, .js_c_order, button:has-text("注文を確定")',
  outOfStock: ':text("在庫がありません"), :text("売り切れ"), :text("完売")',
  orderComplete: ':text("ご注文ありがとう"), :text("注文番号"), .orderComplete',
  loggedInIndicator: '.js_m_memberName, .memberName, a:has-text("ログアウト")',
  savedCardIndicator: '#creditCard\\.securityCode, .savedCard, :text("下4桁")',
} as const;

export interface SessionHandle {
  context: BrowserContext;
  page: Page;
  account: Account;
  proxy?: ProxyConfig;
}

export interface CheckoutOutcome {
  success: boolean;
  orderId?: string;
  durationMs: number;
}

export class BrowserPool {
  private browser: Browser | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly proxyPool: ProxyPool,
  ) {}

  async init(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: this.config.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-http2',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async createSession(
    account: Account,
    accountIndex: number,
    proxyIndex = accountIndex,
  ): Promise<SessionHandle> {
    await this.init();
    if (!this.browser) throw new Error('Browser not initialized');

    const proxy = this.proxyPool.at(proxyIndex);
    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      ...(proxy ? { proxy: this.proxyPool.toPlaywrightProxy(proxy) } : {}),
    });

    context.setDefaultTimeout(this.config.actionTimeoutMs);
    context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    return { context, page, account, proxy };
  }

  async closeSession(session: SessionHandle): Promise<void> {
    await session.context.close();
  }
}

export class YodobashiAutomation {
  constructor(private readonly config: AppConfig) {}

  async login(session: SessionHandle, log: (msg: string) => void): Promise<void> {
    const { page, account } = session;
    log('Navigating to login page');
    await safeGoto(page, URLS.login, this.config.navigationTimeoutMs, log);

    await page.waitForSelector(SELECTORS.memberId, { timeout: this.config.actionTimeoutMs });
    await page.fill(SELECTORS.memberId, account.email);
    await page.fill(SELECTORS.password, account.password);
    await page.click(SELECTORS.loginButton);

    try {
      await Promise.race([
        page.waitForSelector(SELECTORS.loggedInIndicator, { timeout: this.config.navigationTimeoutMs }),
        page.waitForURL(/yodobashi\.com/, { timeout: this.config.navigationTimeoutMs }),
      ]);
    } catch {
      const bodyText = await page.textContent('body').catch(() => '');
      if (bodyText?.includes('captcha') || bodyText?.includes('CAPTCHA')) {
        throw new CheckoutError('CAPTCHA detected during login', 'captcha_blocked');
      }
      throw new CheckoutError('Login failed — check credentials', 'login_failed');
    }

    log('Login successful');
  }

  async clearCart(session: SessionHandle, log: (msg: string) => void): Promise<void> {
    const { page } = session;
    log('Clearing shopping cart');
    await safeGoto(page, URLS.cart, this.config.navigationTimeoutMs, log);

    for (let i = 0; i < 20; i++) {
      const deleteBtn = page.locator(SELECTORS.cartDelete).first();
      if ((await deleteBtn.count()) === 0) break;
      await deleteBtn.click();
      await page.waitForTimeout(300);
    }

    log('Cart cleared');
  }

  async verifyPaymentCard(session: SessionHandle, log: (msg: string) => void): Promise<boolean> {
    const { page } = session;
    log('Checking saved payment card');
    await safeGoto(page, URLS.cartProceed, this.config.navigationTimeoutMs, log);

    const hasSavedCard =
      (await page.locator(SELECTORS.savedCardIndicator).count()) > 0 ||
      (await page.locator(':text("クレジットカード")').count()) > 0;

    log(hasSavedCard ? 'Saved card detected' : 'No saved card — security code may be required');
    return hasSavedCard;
  }

  async isProductAvailable(page: Page, productUrl: string, log?: (msg: string) => void): Promise<boolean> {
    await safeGoto(page, productUrl, this.config.navigationTimeoutMs, log);

    const outOfStock = await page.locator(SELECTORS.outOfStock).count();
    if (outOfStock > 0) return false;

    const addBtn = page.locator(SELECTORS.addToCart);
    if ((await addBtn.count()) === 0) return false;

    const disabled = await addBtn.first().isDisabled().catch(() => false);
    return !disabled;
  }

  async addToCartAndCheckout(
    session: SessionHandle,
    productUrl: string,
    log: (msg: string) => void,
    hasSavedCard: boolean,
  ): Promise<CheckoutOutcome> {
    const start = Date.now();
    const { page } = session;

    log(`Adding product to cart: ${productUrl}`);
    await safeGoto(page, productUrl, this.config.navigationTimeoutMs, log);

    const outOfStock = await page.locator(SELECTORS.outOfStock).count();
    if (outOfStock > 0) {
      throw new CheckoutError('Product out of stock', 'out_of_stock', true);
    }

    await page.waitForSelector(SELECTORS.buyBox, { timeout: this.config.actionTimeoutMs }).catch(() => {
      throw new CheckoutError('Product page not found', 'product_not_found');
    });

    await page.locator(SELECTORS.addToCart).first().click();
    await page.waitForTimeout(500);

    log('Proceeding to checkout');
    await safeGoto(page, URLS.cartProceed, this.config.navigationTimeoutMs, log);
    await page.click(SELECTORS.cartProceed);

    await page.waitForLoadState('domcontentloaded');

    const securityInput = page.locator(SELECTORS.securityCode);
    if ((await securityInput.count()) > 0 && !hasSavedCard) {
      if (!this.config.securityCode) {
        throw new CheckoutError('No saved card and SECURITY_CODE not configured', 'payment_declined');
      }
      log('Entering security code');
      await securityInput.fill(this.config.securityCode);
    } else if ((await securityInput.count()) > 0) {
      log('Skipping card entry — using saved card');
    }

    log('Confirming order');
    await page.locator(SELECTORS.orderConfirm).first().click();

    try {
      await page.waitForSelector(SELECTORS.orderComplete, { timeout: this.config.navigationTimeoutMs });
    } catch {
      const body = await page.textContent('body').catch(() => '');
      if (body?.includes('在庫')) {
        throw new CheckoutError('Out of stock at checkout', 'out_of_stock', true);
      }
      if (body?.includes('カード') || body?.includes('決済')) {
        throw new CheckoutError('Payment declined', 'payment_declined');
      }
      throw new CheckoutError('Checkout did not reach confirmation page', 'checkout_timeout');
    }

    const orderId = await this.extractOrderId(page);
    log(`Order confirmed: ${orderId ?? 'unknown'}`);

    return {
      success: true,
      orderId,
      durationMs: Date.now() - start,
    };
  }

  private async extractOrderId(page: Page): Promise<string | undefined> {
    const body = await page.textContent('body').catch(() => '');
    if (!body) return undefined;

    const patterns = [
      /注文番号[：:\s]*([A-Z0-9-]+)/i,
      /order\s*(?:id|no|number)[：:\s]*([A-Z0-9-]+)/i,
      /(\d{10,})/,
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match?.[1]) return match[1];
    }

    return undefined;
  }
}
