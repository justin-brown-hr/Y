/**
 * Benchmark script — measures checkout step timing against a product page.
 * Run after configuring .env: npm run benchmark
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { performance } from 'node:perf_hooks';
import { loadConfig } from '../src/config.js';
import { BrowserPool } from '../src/browser/yodobashi.js';
import { ProxyPool } from '../src/services/proxy.js';
import { safeGoto } from '../src/browser/navigation.js';

const PRODUCT_URL =
  process.env.BENCHMARK_PRODUCT_URL ??
  'https://www.yodobashi.com/product/100000001003891482/';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.accounts.length === 0) {
    console.error('Set ACCOUNTS in .env to run benchmark');
    process.exit(1);
  }

  const proxyPool = new ProxyPool(config.proxies);
  const browserPool = new BrowserPool(config, proxyPool);
  await browserPool.init();

  const timings: Record<string, number> = {};
  const session = await browserPool.createSession(config.accounts[0], 0);
  const { page } = session;

  try {
    let t = performance.now();
    await safeGoto(page, PRODUCT_URL, config.navigationTimeoutMs, (msg) =>
      console.log(`  ${msg}`),
    );
    timings.pageLoad = performance.now() - t;

    t = performance.now();
    await page.locator('.yBtnText, #js_m_submitRelated').first().count();
    timings.selectorProbe = performance.now() - t;

    console.log('\n=== Benchmark Results ===');
    console.log(`Product: ${PRODUCT_URL}`);
    console.log(`Proxy: ${session.proxy ? `${session.proxy.host}:${session.proxy.port}` : 'none'}`);
    for (const [step, ms] of Object.entries(timings)) {
      console.log(`  ${step}: ${ms.toFixed(0)}ms`);
    }
    console.log(`\nTarget: checkout ≤ 10s average under load`);
    console.log('Full checkout benchmark requires a live in-stock SKU at sale time.');
  } finally {
    await browserPool.closeSession(session);
    await browserPool.shutdown();
  }
}

main().catch(console.error);
