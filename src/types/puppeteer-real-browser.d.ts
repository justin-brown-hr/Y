declare module 'puppeteer-real-browser' {
  export function connect(options?: Record<string, unknown>): Promise<{
    browser: { close(): Promise<void> };
    page: {
      goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
      waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
      type(selector: string, text: string, options?: Record<string, unknown>): Promise<void>;
      click(selector: string): Promise<void>;
      waitForNavigation(options?: Record<string, unknown>): Promise<unknown>;
      content(): Promise<string>;
      $(selector: string): Promise<unknown>;
      cookies(): Promise<Array<{ name: string; value: string; domain?: string; path?: string }>>;
    };
  }>;
}
