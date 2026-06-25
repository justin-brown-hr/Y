import { chromium } from 'playwright';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { loadConfig } from '../src/config.js';
import { ProxyPool } from '../src/services/proxy.js';

async function main() {
  const pool = new ProxyPool(loadConfig().proxies);
  const proxy = pool.at(0);
  if (!proxy) {
    console.log('No proxy in .env');
    process.exit(1);
  }

  const pw = pool.toPlaywrightProxy(proxy);
  console.log(`Testing proxy ${proxy.host}:${proxy.port}...\n`);

  for (const url of [
    'https://httpbin.org/ip',
    'https://www.google.com',
    'https://www.yodobashi.com/product/100000001003891482/',
    'https://order.yodobashi.com/yc/login/index.html',
  ]) {
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-http2', '--no-sandbox'],
    });
    try {
      const page = await (await browser.newContext({ proxy: pw, ignoreHTTPSErrors: true, locale: 'ja-JP' })).newPage();
      const start = Date.now();
      await page.goto(url, { waitUntil: 'commit', timeout: 25000 });
      console.log(`[OK]   ${new URL(url).hostname} — ${Date.now() - start}ms`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.log(`[FAIL] ${new URL(url).hostname} — ${msg}`);
    } finally {
      await browser.close();
    }
  }

  const geo = await fetch(`https://ipinfo.io/${proxy.host}/json`).then((r) => r.json());
  console.log(`\nProxy IP location: ${geo.country} ${geo.city} (${geo.org})`);
}

main().catch(console.error);
