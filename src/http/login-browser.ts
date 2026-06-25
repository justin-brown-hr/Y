import { connect } from 'puppeteer-real-browser';
import type { Account, AppConfig } from '../config.js';
import type { ProxyConfig } from '../config.js';
import { API } from './constants.js';
import type { HttpSession } from './http-session.js';
import { CheckoutError } from '../utils/errors.js';

export async function loginWithRealBrowser(
  session: HttpSession,
  account: Account,
  proxy: ProxyConfig | undefined,
  config: AppConfig,
  log: (msg: string) => void,
): Promise<void> {
  log('Login via puppeteer-real-browser (refer-compatible)');

  const browserProxy = config.browserUseProxy ? proxy : undefined;

  const { browser, page } = await connect({
    headless: config.headless,
    turnstile: true,
    disableXvfb: false,
    args: ['--disable-http2', '--no-sandbox'],
    ...(browserProxy
      ? {
          proxy: {
            host: browserProxy.host,
            port: String(browserProxy.port),
            username: browserProxy.username,
            password: browserProxy.password,
          },
        }
      : {}),
  });

  try {
    await page.goto(API.login, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    await page.waitForSelector('#memberId', { timeout: config.actionTimeoutMs });
    await page.type('#memberId', account.email, { delay: 20 });
    await page.type('#password', account.password, { delay: 20 });
    await page.click('#js_i_login0');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => {});

    const body = await page.content();
    if (body.includes('captcha') || body.includes('CAPTCHA')) {
      throw new CheckoutError('CAPTCHA detected during login', 'captcha_blocked');
    }

    const loggedIn =
      (await page.$('.js_m_memberName, .memberName, a[href*="logout"]')) !== null ||
      !body.includes('js_i_login0');

    if (!loggedIn) {
      throw new CheckoutError('Login failed — check credentials', 'login_failed');
    }

    const cookies = await page.cookies();
    await session.importCookies(cookies);
    log('Login successful — cookies transferred to HTTP session');
  } finally {
    await browser.close();
  }
}

/** Fetch product page HTML via browser (refer loads www through browser, not axios). */
export async function fetchProductHtmlWithBrowser(
  productUrl: string,
  proxy: ProxyConfig | undefined,
  config: AppConfig,
  log: (msg: string) => void,
): Promise<string> {
  log(`Browser GET product page: ${productUrl}`);
  const browserProxy = config.browserUseProxy ? proxy : undefined;

  const { browser, page } = await connect({
    headless: config.headless,
    turnstile: true,
    disableXvfb: false,
    args: ['--disable-http2', '--no-sandbox'],
    ...(browserProxy
      ? {
          proxy: {
            host: browserProxy.host,
            port: String(browserProxy.port),
            username: browserProxy.username,
            password: browserProxy.password,
          },
        }
      : {}),
  });

  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    return await page.content();
  } finally {
    await browser.close();
  }
}
