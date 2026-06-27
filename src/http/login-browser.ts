import { connect } from 'puppeteer-real-browser';
import type { Account, AppConfig, ProxyConfig } from '../config.js';
import { realBrowserOptions } from './browser-options.js';
import { API } from './constants.js';
import type { HttpSession } from './http-session.js';
import { CheckoutError } from '../utils/errors.js';

async function pageSnippet(page: { url(): string; title(): Promise<string> } | unknown): Promise<string> {
  try {
    const p = page as { url(): string; title(): Promise<string> };
    const url = p.url();
    const title = await p.title();
    return `url=${url} title=${title.slice(0, 80)}`;
  } catch {
    return 'page unavailable';
  }
}

export async function loginWithRealBrowser(
  session: HttpSession,
  account: Account,
  proxy: ProxyConfig | undefined,
  config: AppConfig,
  log: (msg: string) => void,
): Promise<void> {
  log('Login step 1/5: launch browser (puppeteer-real-browser)');
  if (config.browserUseProxy && proxy) {
    log(`Login proxy: ${proxy.host}:${proxy.port}`);
  } else {
    log('Login browser: direct (no proxy)');
  }

  let browser;
  try {
    const connected = await connect(realBrowserOptions(config, proxy) as Parameters<typeof connect>[0]);
    browser = connected.browser;
    const { page } = connected;

    log('Login step 2/5: open login page');
    await page.goto(API.login, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    log(`Login page loaded (${await pageSnippet(page)})`);

    log('Login step 3/5: wait for login form #memberId');
    try {
      await page.waitForSelector('#memberId', { timeout: config.actionTimeoutMs });
    } catch {
      const body = await page.content();
      if (body.includes('captcha') || body.includes('CAPTCHA') || body.includes('turnstile')) {
        throw new CheckoutError('CAPTCHA / Turnstile on login page', 'captcha_blocked');
      }
      throw new CheckoutError(
        `Login form not found — ${await pageSnippet(page)}`,
        'login_failed',
      );
    }

    log('Login step 4/5: enter credentials and submit');
    await page.type('#memberId', account.email, { delay: 25 });
    await page.type('#password', account.password, { delay: 25 });

    const submit = await page.$('#js_i_login0');
    if (!submit) {
      const alt = await page.$('button[type="submit"]');
      if (!alt) throw new CheckoutError('Login submit button not found', 'login_failed');
      await (alt as { click(): Promise<void> }).click();
    } else {
      await (submit as { click(): Promise<void> }).click();
    }
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => {});

    const body = await page.content();
    if (body.includes('captcha') || body.includes('CAPTCHA') || body.includes('turnstile')) {
      throw new CheckoutError('CAPTCHA detected after login submit', 'captcha_blocked');
    }

    const loggedIn =
      (await page.$('.js_m_memberName, .memberName, a[href*="logout"]')) !== null ||
      body.includes('ログアウト') ||
      !body.includes('js_i_login0');

    if (!loggedIn) {
      const hint = body.includes('パスワード') || body.includes('memberId')
        ? ' — wrong email or password?'
        : '';
      throw new CheckoutError(
        `Login failed after submit${hint} (${await pageSnippet(page)})`,
        'login_failed',
      );
    }

    log('Login step 5/5: transfer cookies to HTTP session');
    const cookies = await page.cookies();
    await session.importCookies(cookies);
    log(`Login successful — ${cookies.length} cookies imported`);
  } catch (err) {
    if (err instanceof CheckoutError) throw err;
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new CheckoutError(`Browser login error: ${msg}`, 'login_failed');
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function fetchProductHtmlWithBrowser(
  productUrl: string,
  proxy: ProxyConfig | undefined,
  config: AppConfig,
  log: (msg: string) => void,
): Promise<string> {
  log(`Browser GET product page: ${productUrl}`);

  const { browser, page } = await connect(
    realBrowserOptions(config, proxy) as Parameters<typeof connect>[0],
  );

  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    return await page.content();
  } finally {
    await browser.close();
  }
}
