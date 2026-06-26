# Yodobashi Checkout Automation

> **Client handoff:** see [CLIENT-HANDOFF.md](CLIENT-HANDOFF.md) for setup, checklist, deployment, and how to use.

Production-ready browser automation for [Yodobashi.com](https://www.yodobashi.com/) with a token-authenticated REST API, multi-account proxy routing, scheduled pre-login, and Discord webhook reporting.

## Features

- **Normal mode** — Purchase a single product at a fixed JST sale time (default 09:30:00)
- **Monitor mode** — Poll multiple product URLs until one becomes available, then checkout immediately
- **Pre-login** — Accounts log in 5–10 minutes before sale, clear cart, verify saved payment card
- **Multi-account** — Run one job per account in parallel (up to 50 concurrent browsers)
- **Proxy rotation** — Each account mapped to a proxy from the pool
- **Discord webhooks** — Success/failure reports with order ID, account, error category
- **Full API** — Start job, list jobs, job status, cancel, logs

## Quick Start

```bash
cp .env.example .env
# Edit .env with your API token, accounts, proxies, and Discord webhook

npm install
npx playwright install chromium
npm run build
npm start
```

Development with hot reload:

```bash
npm run dev
```

## Environment Variables

See [`.env.example`](.env.example). Key settings:

| Variable | Description |
|----------|-------------|
| `API_TOKEN` | Bearer token for all API requests |
| `ACCOUNTS` | `email:password` pairs, comma-separated |
| `PROXIES` | `host:port:user:pass` pairs, comma-separated |
| `DISCORD_WEBHOOK_URL` | Discord webhook for job results |
| `DEFAULT_SALE_TIME` | JST sale time `HH:MM:SS` (default `09:30:00`) |
| `MAX_PARALLEL_JOBS` | Max concurrent checkouts (default `50`) |
| `SECURITY_CODE` | CVV for accounts without a saved card |

## API Reference

All endpoints require `Authorization: Bearer <API_TOKEN>`.

### Health check

```bash
curl http://localhost:3000/health
```

### Start a normal-mode job (single account)

Purchases one product at the configured sale time. Pre-login happens 5–10 min before.

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "normal",
    "productUrl": "https://www.yodobashi.com/product/100000001003891482/",
    "saleTime": "09:30:00"
  }'
```

Product code shorthand:

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "normal",
    "productCode": "100000001003891482",
    "saleTime": "09:30:00"
  }'
```

### Start jobs for all accounts simultaneously

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "normal",
    "productUrl": "https://www.yodobashi.com/product/100000001003891482/",
    "saleTime": "09:30:00",
    "allAccounts": true
  }'
```

### Start a monitor-mode job (multiple products)

Polls until any product becomes purchasable, then checks out.

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "monitor",
    "productUrls": [
      "https://www.yodobashi.com/product/100000001003891482/",
      "https://www.yodobashi.com/product/ANOTHER_CODE/"
    ]
  }'
```

### Get job status

```bash
curl http://localhost:3000/jobs/<JOB_ID> \
  -H "Authorization: Bearer $API_TOKEN"
```

### List all jobs

```bash
curl http://localhost:3000/jobs \
  -H "Authorization: Bearer $API_TOKEN"
```

### Get job logs

```bash
curl http://localhost:3000/jobs/<JOB_ID>/logs \
  -H "Authorization: Bearer $API_TOKEN"
```

### Cancel a job

```bash
curl -X POST http://localhost:3000/jobs/<JOB_ID>/cancel \
  -H "Authorization: Bearer $API_TOKEN"
```

## Job Lifecycle

```
pending → pre_login → waiting → running → completed | failed | cancelled
```

1. **pre_login** — Browser session opens via assigned proxy
2. **waiting** — Sleeps until 5–10 min before sale (normal) or polls product (monitor)
3. **running** — Login, clear cart, verify card, add to cart, confirm payment
4. **completed/failed** — Discord webhook fired with result

## Error Categories

Webhook and job results include categorized errors:

| Category | Meaning |
|----------|---------|
| `out_of_stock` | Product unavailable |
| `payment_declined` | Card/payment rejected |
| `proxy_timeout` | Proxy connection timed out |
| `proxy_error` | General proxy failure |
| `login_failed` | Account credentials rejected |
| `captcha_blocked` | CAPTCHA detected |
| `product_not_found` | Invalid product URL |
| `cart_error` | Cart operation failed |
| `checkout_timeout` | Did not reach confirmation page |
| `network_error` | Network-level failure |

## Benchmark

```bash
npm run benchmark
```

Measures page-load and selector probe latency. Full end-to-end checkout timing depends on sale-time network conditions; target is **≤ 10 seconds average** per checkout under load with 50 parallel sessions.

## Architecture

**Default engine: `http`** (same approach as refer `YodoTool`)

| | Refer YodoTool | This project (http mode) |
|--|----------------|--------------------------|
| Login | `puppeteer-real-browser` + proxy | Same |
| Product page | **HTTP GET** via axios (not browser) | Same |
| Add to cart | **POST** `shoppingcart/add/index.html` | Same |
| Checkout | HTTP API chain (`callNextCart`, `callGetOrderIndex`, …) | Same |
| Proxy | `https-proxy-agent` on axios | Same |

Playwright full-page mode is still available with `CHECKOUT_ENGINE=browser` (legacy, slower, more likely blocked).

```
src/
├── http/                   # Refer-compatible HTTP engine (default)
│   ├── checkout.ts         # callApiAddCart, order flow
│   ├── product.ts          # HTTP product fetch + parse
│   ├── login-browser.ts    # puppeteer-real-browser login
│   └── http-session.ts     # axios + cookie jar + proxy
├── browser/yodobashi.ts    # Legacy Playwright engine
└── jobs/job-manager.ts
```

## Troubleshooting

### Test connectivity before sale day

```bash
npm run test:connectivity
```

This tries direct access and each configured proxy against the Yodobashi login page. You should see `[OK]` for at least one path.

If all fail with timeout:
- Yodobashi often **blocks non-Japan IPs** — use a **Japan residential proxy**
- Datacenter proxies (US/EU) are frequently blocked even if they work for Google
- Increase `NAVIGATION_TIMEOUT_MS=30000` in `.env` for slow proxies

### HTTP/2 / proxy errors

The browser disables HTTP/2 automatically. On network errors the job **rotates through all configured proxies** before failing.

### Discord not receiving messages

Verify webhook URL and run:

```bash
curl -X POST "$DISCORD_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content":"test"}'
```

Expected response: HTTP `204`.

## Security Notes

- Never commit `.env` — credentials belong in environment variables only
- Rotate API tokens and proxy credentials regularly
- Use dedicated accounts; avoid storing CVV unless required for unsaved cards

## License

Private — for authorized use only.
