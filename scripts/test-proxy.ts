import dotenv from 'dotenv';
dotenv.config({ override: true });
import { loadConfig } from '../src/config.js';
import { ProxyPool } from '../src/services/proxy.js';
import { HttpSession } from '../src/http/http-session.js';

async function main() {
  const config = loadConfig();
  const pool = new ProxyPool(config.proxies);

  async function ping(label: string, session: HttpSession) {
    const t = Date.now();
    const res = await session.get('https://www.google.com');
    console.log(`${label}: HTTP ${res.status} in ${Date.now() - t}ms`);
  }

  await ping('google direct', new HttpSession(undefined, 15000, false));
  for (let i = 0; i < pool.count; i++) {
    const p = pool.at(i)!;
    await ping(`google via ${p.host}`, new HttpSession(p, 15000, true));
  }
}

main().catch((e) => console.error('FAIL', e.message));
