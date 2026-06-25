/**
 * Tests HTTP connectivity using fetch (refer-compatible — NOT axios).
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { loadConfig } from '../src/config.js';
import { ProxyPool } from '../src/services/proxy.js';
import { HttpSession } from '../src/http/http-session.js';
import { fetchProduct } from '../src/http/product.js';
import { API } from '../src/http/constants.js';

const PRODUCT = 'https://www.yodobashi.com/product/100000001003891482/';

async function test(label: string, session: HttpSession): Promise<boolean> {
  try {
    const t = Date.now();
    const login = await session.get(API.login);
    const loginOk = login.status < 500 && login.data.includes('memberId');
    let productFields = 0;
    let productErr = '';

    try {
      const product = await fetchProduct(session, PRODUCT);
      productFields = Object.keys(product.fields).length;
    } catch (err) {
      productErr = err instanceof Error ? err.message.split('\n')[0] : String(err);
    }

    const ms = Date.now() - t;
    if (loginOk && productFields > 0) {
      console.log(`[OK]   ${label} — ${ms}ms | login HTTP ${login.status} | product fields=${productFields}`);
      return true;
    }

    console.log(
      `[FAIL] ${label} — ${ms}ms | login HTTP ${login.status} loginOk=${loginOk} | product: ${productErr || `fields=${productFields}`}`,
    );
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.log(`[FAIL] ${label} — ${msg}`);
    return false;
  }
}

async function main() {
  const config = loadConfig();
  const pool = new ProxyPool(config.proxies);
  console.log(`Engine: ${config.checkoutEngine} | HTTP_USE_PROXY=${config.httpUseProxy}\n`);

  let anyOk = await test(
    'direct HTTP (no proxy)',
    new HttpSession(undefined, config.navigationTimeoutMs, false),
  );

  if (config.httpUseProxy) {
    for (let i = 0; i < pool.count; i++) {
      const p = pool.at(i)!;
      const ok = await test(
        `HTTP via proxy ${p.host}:${p.port}`,
        new HttpSession(p, config.navigationTimeoutMs, true),
      );
      anyOk = anyOk || ok;
    }
  }

  console.log('');
  if (!anyOk) {
    console.log('Tip: set HTTP_USE_PROXY=false in .env (refer uses browser+proxy for login, HTTP direct for API)');
  }
  process.exit(anyOk ? 0 : 1);
}

main().catch(console.error);
