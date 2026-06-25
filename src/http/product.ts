import * as cheerio from 'cheerio';
import { BASE_WWW, IN_STOCK_CODES, PRODUCT_FIELD_PREFIX } from './constants.js';
import type { HttpSession } from './http-session.js';
import { CheckoutError } from '../utils/errors.js';

export interface ProductFields {
  productId: string;
  productUrl: string;
  fields: Record<string, string>;
  stockStatusCode?: string;
  inStock?: boolean;
}

const PRODUCT_FIELD_NAMES = [
  'cartInSKU',
  'itemId',
  'serviceFlag',
  'amount',
  'price',
  'encryptPriceC',
  'pointRate',
  'encryptPointRate',
  'salesInformationCodeC',
  'salesReleaseDay',
  'salesReleaseDayString',
  'stockStatusCode',
  'isDownload',
  'readCheckFlg',
] as const;

export function productUrls(productId: string): string[] {
  const id = productId.replace(/\D/g, '');
  return [
    `${BASE_WWW}/product/${id}/`,
    `${BASE_WWW}/ec/product/${id}/index.html`,
  ];
}

export function productUrl(productId: string): string {
  return productUrls(productId)[0];
}

function extractFieldsFromHtml(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const $ = cheerio.load(html);

  $('input, select, textarea').each((_, el) => {
    const name = $(el).attr('name');
    if (!name?.startsWith(PRODUCT_FIELD_PREFIX)) return;
    const value = $(el).val()?.toString() ?? $(el).attr('value') ?? '';
    if (value !== '') fields[name] = value;
  });

  for (const key of PRODUCT_FIELD_NAMES) {
    const fullKey = `${PRODUCT_FIELD_PREFIX}${key}`;
    if (fields[fullKey]) continue;

    const patterns = [
      new RegExp(`${key}["'\\s:=]+(["']?)([0-9A-Za-z+/=_-]+)\\1`),
      new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`),
      new RegExp(`'${key}'\\s*:\\s*'([^']+)'`),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[2] ?? match?.[1]) {
        fields[fullKey] = match[2] ?? match[1];
        break;
      }
    }
  }

  return fields;
}

export function parseProductHtml(html: string, productId: string, url: string): ProductFields {
  const fields = extractFieldsFromHtml(html);

  if (!fields[`${PRODUCT_FIELD_PREFIX}cartInSKU`]) {
    fields[`${PRODUCT_FIELD_PREFIX}cartInSKU`] = productId;
  }
  if (!fields[`${PRODUCT_FIELD_PREFIX}itemId`]) {
    fields[`${PRODUCT_FIELD_PREFIX}itemId`] = productId;
  }
  if (!fields[`${PRODUCT_FIELD_PREFIX}amount`]) {
    fields[`${PRODUCT_FIELD_PREFIX}amount`] = '1';
  }

  const stockStatusCode = fields[`${PRODUCT_FIELD_PREFIX}stockStatusCode`];

  return { productId, productUrl: url, fields, stockStatusCode };
}

export function isInStock(product: ProductFields, html?: string): boolean {
  if (product.stockStatusCode) {
    return IN_STOCK_CODES.has(product.stockStatusCode);
  }
  if (html) {
    if (/在庫がありません|売り切れ|完売/.test(html)) return false;
    if (/ショッピングカートに入れる|cartInSKU|js_buyBox|yBtnText/.test(html)) return true;
  }
  return Boolean(
    product.fields[`${PRODUCT_FIELD_PREFIX}cartInSKU`] ||
      product.fields[`${PRODUCT_FIELD_PREFIX}itemId`],
  );
}

export async function fetchProduct(
  session: HttpSession,
  productIdOrUrl: string,
  log?: (msg: string) => void,
): Promise<ProductFields> {
  const urls = productIdOrUrl.startsWith('http')
    ? [productIdOrUrl]
    : productUrls(productIdOrUrl.replace(/\D/g, ''));

  let lastError: unknown;

  for (const url of urls) {
    const productId = url.match(/(\d{10,})/)?.[1] ?? productIdOrUrl.replace(/\D/g, '');
    try {
      log?.(`HTTP GET product page: ${url}`);
      const res = await session.get(url, BASE_WWW);

      if (res.status >= 400) {
        lastError = new CheckoutError(`Product page HTTP ${res.status}`, 'product_not_found');
        continue;
      }

      const html = String(res.data);
      if (html.length < 500) {
        lastError = new CheckoutError('Product page empty or blocked', 'proxy_error', true);
        continue;
      }

      const parsed = parseProductHtml(html, productId, url);
      parsed.inStock = isInStock(parsed, html);

      if (Object.keys(parsed.fields).length < 3) {
        lastError = new CheckoutError('Could not parse product fields from page', 'product_not_found');
        continue;
      }

      if (!parsed.inStock) {
        log?.('Product may be out of stock');
      }
      return parsed;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new CheckoutError('Failed to fetch product page', 'product_not_found');
}

export function buildAddCartPayload(product: ProductFields): Record<string, string> {
  const payload: Record<string, string> = { ...product.fields };
  if (!payload[`${PRODUCT_FIELD_PREFIX}amount`]) {
    payload[`${PRODUCT_FIELD_PREFIX}amount`] = '1';
  }
  return payload;
}
