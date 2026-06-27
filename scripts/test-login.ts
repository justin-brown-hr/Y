/**
 * Test login only — run: npx tsx scripts/test-login.ts
 * Optional env: TEST_EMAIL, TEST_PASSWORD, TEST_PROXY (host:port:user:pass)
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { loadConfig, parseProxyEntry } from '../src/config.js';
import { HttpSession } from '../src/http/http-session.js';
import { YodobashiHttpCheckout } from '../src/http/checkout.js';

async function main() {
  const config = loadConfig();
  const email = process.env.TEST_EMAIL ?? config.accounts[0]?.email;
  const password = process.env.TEST_PASSWORD ?? config.accounts[0]?.password;
  const proxyRaw = process.env.TEST_PROXY;
  const proxy = proxyRaw
    ? parseProxyEntry(proxyRaw)
    : config.proxies[0];

  if (!email || !password) {
    console.error('Set TEST_EMAIL / TEST_PASSWORD or ACCOUNTS in .env');
    process.exit(1);
  }

  console.log(`Account: ${email}`);
  console.log(`Proxy: ${proxy ? `${proxy.host}:${proxy.port}` : 'none'}`);
  console.log(`Browser proxy: ${config.browserUseProxy}`);
  console.log(`Headless: ${config.headless}`);
  console.log('---');

  const session = new HttpSession(proxy, config.navigationTimeoutMs, config.httpUseProxy);
  const checkout = new YodobashiHttpCheckout(config);
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    await checkout.login(session, { email, password }, proxy, log);
    console.log('\n[OK] Login test passed');
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n[FAIL]', msg);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
