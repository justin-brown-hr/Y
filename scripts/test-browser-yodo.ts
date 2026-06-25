import dotenv from 'dotenv';
dotenv.config({ override: true });
import { connect } from 'puppeteer-real-browser';
import { loadConfig } from '../src/config.js';
import { ProxyPool } from '../src/services/proxy.js';
import { API } from '../src/http/constants.js';

async function main() {
  const config = loadConfig();
  const pool = new ProxyPool(config.proxies);
  const proxy = pool.at(0);

  console.log('Testing puppeteer-real-browser (refer login method)...');
  const { browser, page } = await connect({
    headless: config.headless,
    turnstile: true,
    disableXvfb: false,
    args: ['--disable-http2', '--no-sandbox'],
    ...(proxy
      ? {
          proxy: {
            host: proxy.host,
            port: String(proxy.port),
            username: proxy.username,
            password: proxy.password,
          },
        }
      : {}),
  });

  try {
    for (const url of [
      API.login,
      'https://www.yodobashi.com/product/100000001003891482/',
    ]) {
      const t = Date.now();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const title = await page.title();
        const hasMember = (await page.$('#memberId')) !== null;
        const hasBuy = (await page.$('#js_buyBox, .yBtnText')) !== null;
        console.log(`[OK]   ${new URL(url).pathname.slice(0, 40)} — ${Date.now() - t}ms | ${title.slice(0, 30)} | login=${hasMember} buy=${hasBuy}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
        console.log(`[FAIL] ${url} — ${msg}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
