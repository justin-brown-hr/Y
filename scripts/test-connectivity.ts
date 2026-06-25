/**
 * Tests each configured proxy against Yodobashi login page.
 * Usage: npm run test:connectivity
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import { loadConfig } from '../src/config.js';
import { ProxyPool } from '../src/services/proxy.js';

const TARGET = 'https://order.yodobashi.com/yc/login/index.html';

async function testProxy(label: string, proxy?: ReturnType<ProxyPool['toPlaywrightProxy']>) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-http2', '--no-sandbox'],
  });

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      locale: 'ja-JP',
      ...(proxy ? { proxy } : {}),
    });
    const page = await context.newPage();
    const start = Date.now();
    await page.goto(TARGET, { waitUntil: 'commit', timeout: 30000 });
    const ms = Date.now() - start;
    const hasLogin = (await page.locator('#memberId, input#memberId').count()) > 0;
    console.log(`[OK]   ${label} — ${ms}ms, login form=${hasLogin}`);
    await context.close();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.log(`[FAIL] ${label} — ${msg}`);
    return false;
  } finally {
    await browser.close();
  }
}

async function main() {
  const config = loadConfig();
  const pool = new ProxyPool(config.proxies);

  console.log('Testing Yodobashi connectivity...\n');

  const directOk = await testProxy('direct (no proxy)', undefined);

  if (pool.count === 0) {
    process.exit(directOk ? 0 : 1);
    return;
  }

  let anyOk = directOk;
  for (let i = 0; i < pool.count; i++) {
    const p = pool.at(i)!;
    const ok = await testProxy(`${p.host}:${p.port}`, pool.toPlaywrightProxy(p));
    anyOk = anyOk || ok;
  }

  console.log('');
  if (!anyOk) {
    console.log('All connectivity tests failed.');
    console.log('Yodobashi often requires a Japan residential proxy. Datacenter/US IPs are frequently blocked.');
  }
  process.exit(anyOk ? 0 : 1);
}

main().catch(console.error);
