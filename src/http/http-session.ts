import { CookieJar } from 'tough-cookie';
import { fetch, ProxyAgent, type Dispatcher } from 'undici';
import type { ProxyConfig } from '../config.js';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

/** Browser-like headers extracted from refer handle.jsc */
const BASE_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'ja-JP,ja;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'sec-ch-ua': '"Chromium";v="134", "Google Chrome";v="134", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1',
};

export interface HttpResponse {
  status: number;
  data: string;
  url: string;
  headers: Headers;
}

export class HttpSession {
  readonly jar = new CookieJar();
  readonly proxy?: ProxyConfig;
  private readonly dispatcher?: Dispatcher;
  private readonly timeoutMs: number;

  /**
   * @param proxy - optional proxy for HTTP (refer uses proxy; set HTTP_USE_PROXY=false if proxy breaks Yodobashi HTTP)
   */
  constructor(proxy?: ProxyConfig, timeoutMs = 30000, useProxy = true) {
    this.proxy = proxy;
    this.timeoutMs = timeoutMs;

    if (proxy && useProxy) {
      const auth = `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}`;
      this.dispatcher = new ProxyAgent(`http://${auth}@${proxy.host}:${proxy.port}`);
    }
  }

  async importCookies(
    cookies: Array<{ name: string; value: string; domain?: string; path?: string }>,
  ): Promise<void> {
    for (const cookie of cookies) {
      const domain = cookie.domain?.startsWith('.')
        ? cookie.domain
        : `.${cookie.domain ?? 'yodobashi.com'}`;
      const path = cookie.path ?? '/';
      const serialized = `${cookie.name}=${cookie.value}; Domain=${domain}; Path=${path}`;
      await this.jar.setCookie(serialized, 'https://www.yodobashi.com');
      await this.jar.setCookie(serialized, 'https://order.yodobashi.com');
    }
  }

  private async applyCookies(url: string, headers: Record<string, string>): Promise<void> {
    const cookies = await this.jar.getCookieString(url);
    if (cookies) headers.Cookie = cookies;
  }

  private async storeCookies(url: string, responseHeaders: Headers): Promise<void> {
    const raw = responseHeaders.getSetCookie?.() ?? [];
    const fallback = responseHeaders.get('set-cookie');
    const list = raw.length > 0 ? raw : fallback ? [fallback] : [];

    for (const line of list) {
      for (const base of [url, 'https://www.yodobashi.com/', 'https://order.yodobashi.com/']) {
        try {
          await this.jar.setCookie(line, base);
        } catch {
          // ignore
        }
      }
    }
  }

  private navigationHeaders(referer?: string): Record<string, string> {
    return {
      ...BASE_HEADERS,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
      'Sec-Fetch-User': '?1',
      ...(referer ? { Referer: referer } : {}),
    };
  }

  async request(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<HttpResponse> {
    let requestUrl: string;
    try {
      requestUrl = new URL(url.trim()).href;
    } catch {
      throw new Error(`Invalid URL: ${url.slice(0, 120)}`);
    }

    const headers = { ...this.navigationHeaders(), ...init.headers };
    await this.applyCookies(requestUrl, headers);

    const res = await fetch(requestUrl, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
      redirect: 'follow',
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await res.text();
    const finalUrl = res.url || requestUrl;
    await this.storeCookies(finalUrl, res.headers);

    return { status: res.status, data: text, url: finalUrl, headers: res.headers };
  }

  async get(url: string, referer?: string): Promise<HttpResponse> {
    return this.request(url, { headers: this.navigationHeaders(referer) });
  }

  async postForm(
    url: string,
    data: Record<string, string>,
    referer?: string,
  ): Promise<HttpResponse> {
    const body = new URLSearchParams(data).toString();
    return this.request(url, {
      method: 'POST',
      headers: {
        ...this.navigationHeaders(referer),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
      },
      body,
    });
  }

  finalUrl(response: HttpResponse): string {
    return response.url;
  }
}
