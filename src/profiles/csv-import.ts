export interface CsvScheduleRow {
  name: string;
  email: string;
  password: string;
  proxy?: string;
  cardNumber?: string;
  cardMonth?: string;
  cardYear?: string;
  cvv?: string;
  mode: 'normal' | 'monitor';
  products: string[];
  quantity?: number;
  loginDelayMinutes?: number;
  loginTime?: string;
  saleTime: string;
  monitorPollIntervalMs?: number;
  enabled: boolean;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseBool(raw: string | undefined): boolean {
  if (!raw) return true;
  const v = raw.trim().toLowerCase();
  if (['no', 'false', '0', 'off', 'disabled'].includes(v)) return false;
  return true;
}

function parseMode(raw: string | undefined): 'normal' | 'monitor' {
  return raw?.trim().toLowerCase() === 'monitor' ? 'monitor' : 'normal';
}

function parseProducts(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeTime(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const parts = raw.trim().split(':');
  if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
  if (parts.length === 3) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
  }
  return raw.trim();
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['profile_name', 'profilename', 'name', 'label'],
  email: ['email', 'account', 'user'],
  password: ['password', 'pass'],
  proxy: ['proxy', 'proxy_host'],
  card_number: ['cardnumber', 'card_number', 'card'],
  card_month: ['cardmonth', 'card_month', 'exp_month'],
  card_year: ['cardyear', 'card_year', 'exp_year'],
  cvv: ['cvv', 'security_code', 'cvc'],
  mode: ['mode'],
  product: ['product', 'products', 'product_url', 'url'],
  quantity: ['quantity', 'qty'],
  login_delay_minutes: ['delay', 'delay_min', 'delay_minutes', 'stagger_min'],
  login_time: ['time_login', 'login_time', 'logintime', 'pre_login'],
  sale_time: ['start_time', 'sale_time', 'saletime'],
  monitor_poll_ms: ['monitor_poll_ms', 'poll_ms', 'scan_interval_ms'],
  enabled: ['enabled', 'active', 'schedule'],
};

function mapHeaders(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const norm = normalizeHeader(h);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm)) {
        map[key] = i;
        break;
      }
    }
  });
  return map;
}

function cell(row: string[], map: Record<string, number>, key: string): string | undefined {
  const idx = map[key];
  if (idx === undefined) return undefined;
  const v = row[idx]?.trim();
  return v || undefined;
}

/** Parse client schedule CSV (docs/profile.csv format). Skips empty rows and header-only lines. */
export function parseScheduleCsv(text: string): CsvScheduleRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  const map = mapHeaders(headers);
  const rows: CsvScheduleRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const email = cell(cols, map, 'email');
    const password = cell(cols, map, 'password');
    const mode = parseMode(cell(cols, map, 'mode'));
    const products = parseProducts(cell(cols, map, 'product'));
    const saleTime = normalizeTime(cell(cols, map, 'sale_time')) ?? '09:30:00';

    if (!email && !password && products.length === 0) continue;

    rows.push({
      name: cell(cols, map, 'name') ?? (email ? email.split('@')[0] : `Row ${i}`),
      email: email ?? '',
      password: password ?? '',
      proxy: cell(cols, map, 'proxy'),
      cardNumber: cell(cols, map, 'card_number'),
      cardMonth: cell(cols, map, 'card_month'),
      cardYear: cell(cols, map, 'card_year'),
      cvv: cell(cols, map, 'cvv'),
      mode,
      products,
      quantity: cell(cols, map, 'quantity') ? Number(cell(cols, map, 'quantity')) : undefined,
      loginDelayMinutes: cell(cols, map, 'login_delay_minutes')
        ? Number(cell(cols, map, 'login_delay_minutes'))
        : undefined,
      loginTime: normalizeTime(cell(cols, map, 'login_time')),
      saleTime,
      monitorPollIntervalMs: cell(cols, map, 'monitor_poll_ms')
        ? Number(cell(cols, map, 'monitor_poll_ms'))
        : undefined,
      enabled: parseBool(cell(cols, map, 'enabled')),
    });
  }

  return rows;
}
