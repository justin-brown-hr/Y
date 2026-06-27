import { platform } from 'node:os';
import type { AppConfig, ProxyConfig } from '../config.js';

export function isWindows(): boolean {
  return platform() === 'win32';
}

/** puppeteer-real-browser options — Xvfb is Linux-only; Windows needs disableXvfb true */
export function realBrowserOptions(
  config: AppConfig,
  proxy: ProxyConfig | undefined,
): Record<string, unknown> {
  const browserProxy = config.browserUseProxy ? proxy : undefined;
  const win = isWindows();

  return {
    headless: config.headless,
    turnstile: true,
    disableXvfb: win || platform() === 'darwin',
    args: [
      '--disable-http2',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(win ? ['--disable-gpu', '--disable-dev-shm-usage'] : []),
    ],
    ...(browserProxy
      ? {
          proxy: {
            host: browserProxy.host,
            port: String(browserProxy.port),
            username: browserProxy.username,
            password: browserProxy.password,
          },
        }
      : {}),
  };
}
