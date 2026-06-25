import type { ProxyConfig } from '../config.js';

export class ProxyPool {
  private index = 0;

  constructor(private readonly proxies: ProxyConfig[]) {}

  get size(): number {
    return this.proxies.length;
  }

  next(): ProxyConfig | undefined {
    if (this.proxies.length === 0) return undefined;
    const proxy = this.proxies[this.index % this.proxies.length];
    this.index += 1;
    return proxy;
  }

  forAccount(accountIndex: number): ProxyConfig | undefined {
    if (this.proxies.length === 0) return undefined;
    return this.proxies[accountIndex % this.proxies.length];
  }

  at(index: number): ProxyConfig | undefined {
    if (this.proxies.length === 0) return undefined;
    return this.proxies[index % this.proxies.length];
  }

  get count(): number {
    return this.proxies.length;
  }

  toPlaywrightProxy(proxy: ProxyConfig) {
    return {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
    };
  }
}
