# Yodobashi Checkout — Client Handoff

Production checkout automation for Yodobashi.com with API, dashboard, proxy rotation, and Discord reporting.

---

## 1. Quick start (5 minutes)

```bash
cd yodobashi-checkout
cp .env.example .env
# Edit .env — see section 3

npm install
npx playwright install chromium
npm run build
npm run test:connectivity    # must show [OK]
npm start
```

Open dashboard: **http://YOUR_SERVER_IP:PORT/**  
Enter `API_TOKEN` from `.env` when prompted.

---

## 2. How to use

### Dashboard (recommended)

1. Connect with API token
2. **Profiles** tab — accounts & proxies from `.env` appear automatically (User 1, Proxy 1–3)
3. Add custom profiles in the table if needed
4. **Jobs** tab — select account + proxy, paste product URL, choose mode:
   - **Normal** — buys at fixed JST sale time (default `09:30:00`)
   - **Monitor** — polls until product is in stock, then buys
5. Click **Start job** — watch logs in Job detail panel
6. **Stop** cancels a running job; **Delete** removes it from the list

### API (curl)

```bash
export API_TOKEN=your-token
export BASE=http://localhost:3004

# Health (no auth)
curl $BASE/health

# Start monitor job
curl -X POST $BASE/jobs \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "monitor",
    "productUrls": ["https://www.yodobashi.com/product/100000001003891482/"],
    "accountEmail": "user@example.com",
    "accountPassword": "password",
    "proxy": "74.81.32.177:7700:user:pass"
  }'

# Start normal job (sale at 09:30 JST)
curl -X POST $BASE/jobs \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "normal",
    "productUrl": "https://www.yodobashi.com/product/100000001003891482/",
    "saleTime": "09:30:00",
    "accountEmail": "user@example.com",
    "accountPassword": "password",
    "proxy": "74.81.32.177:7700:user:pass"
  }'

# List / status / logs / cancel / delete
curl -H "Authorization: Bearer $API_TOKEN" $BASE/jobs
curl -H "Authorization: Bearer $API_TOKEN" $BASE/jobs/JOB_ID
curl -H "Authorization: Bearer $API_TOKEN" $BASE/jobs/JOB_ID/logs
curl -X POST -H "Authorization: Bearer $API_TOKEN" $BASE/jobs/JOB_ID/cancel
curl -X DELETE -H "Authorization: Bearer $API_TOKEN" $BASE/jobs/JOB_ID
```

### Sale day workflow

| Time (JST) | Action |
|------------|--------|
| ~09:20–09:25 | Start **normal** jobs (pre-login runs 5–10 min before sale) |
| 09:30:00 | Tool adds to cart and checks out automatically |
| After | Check Discord webhook + dashboard for order ID |

For unknown release time, use **monitor** mode instead.

---

## 3. Environment variables (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `API_TOKEN` | Yes | Secret for API + dashboard login |
| `PORT` | No | Default `3000` |
| `ACCOUNTS` | Yes | `email:password` comma-separated |
| `PROXIES` | Yes | `host:port:user:pass` comma-separated |
| `DISCORD_WEBHOOK_URL` | Yes | Discord notifications |
| `DEFAULT_SALE_TIME` | No | `09:30:00` JST |
| `SECURITY_CODE` | If no saved card | CVV for checkout |
| `CHECKOUT_ENGINE` | No | `http` (recommended) |
| `HTTP_USE_PROXY` | No | `false` — HTTP cart uses direct connection |
| `BROWSER_USE_PROXY` | No | `true` — browser login uses proxy |

**Never commit `.env` to git.**

---

## 4. Pre-go-live checklist

Run these **before the real sale**:

- [ ] `npm run test:connectivity` → `[OK]` for Yodobashi login + product
- [ ] `npm run test:proxy` → proxies reach internet
- [ ] Discord test: `curl -X POST "$DISCORD_WEBHOOK_URL" -H "Content-Type: application/json" -d '{"content":"test"}'` → HTTP `204`
- [ ] Dashboard opens and shows `.env` profiles
- [ ] **Monitor job** — confirm login + cart clear in logs → cancel before purchase
- [ ] **Normal job** — set sale time 2–3 min ahead → confirm `waiting` → `pre_login` → cancel
- [ ] Yodobashi account has **saved payment card** OR `SECURITY_CODE` set
- [ ] Server stays running (PM2 or systemd — section 5)
- [ ] Optional: one real test purchase on cheap in-stock item

---

## 5. Always-on deployment

### Option A — PM2 (recommended)

```bash
npm install -g pm2
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # follow printed command for boot on restart
```

Commands:

```bash
pm2 status
pm2 logs yodobashi-checkout
pm2 restart yodobashi-checkout
pm2 stop yodobashi-checkout
```

### Option B — systemd

```bash
sudo cp deploy/yodobashi-checkout.service /etc/systemd/system/
# Edit User= and WorkingDirectory= in the service file
sudo systemctl daemon-reload
sudo systemctl enable yodobashi-checkout
sudo systemctl start yodobashi-checkout
sudo systemctl status yodobashi-checkout
```

### After code or `.env` changes

```bash
npm run build
pm2 restart yodobashi-checkout
# or: sudo systemctl restart yodobashi-checkout
```

---

## 6. Architecture summary

```
Dashboard / API
      ↓
Job Manager (normal | monitor)
      ↓
Browser login (puppeteer-real-browser + proxy)
      ↓
HTTP checkout (add cart → payment → confirm)
      ↓
Discord webhook
```

---

## 7. Known limitations

| Item | Detail |
|------|--------|
| Job history | Stored in RAM — **lost on server restart** |
| Custom profiles | Stored in browser only — not synced across devices |
| `.env` profiles | Read-only in UI — edit `.env` + restart server |
| Load testing | 50 parallel jobs not verified on this server yet |
| End-to-end purchase | Must be validated on sale day or test SKU |

---

## 8. Troubleshooting

| Problem | Fix |
|---------|-----|
| Connectivity test fails | Check Japan proxy; set `HTTP_USE_PROXY=false` |
| Login fails in job | Verify proxy + account; run `npx tsx scripts/test-browser-yodo.ts` |
| Cancel doesn't work | Hard refresh dashboard (`Ctrl+Shift+R`) |
| Port in use | `fuser PORT/tcp` then kill process or change `PORT` |
| Payment declined | Add saved card on Yodobashi or set `SECURITY_CODE` |

---

## 9. File map

```
src/
  api/routes.ts       REST + dashboard
  jobs/job-manager.ts Job scheduling
  http/checkout.ts    Cart + payment flow
  http/login-browser.ts Browser login
public/dashboard.html Web UI
.env.example          Config template
ecosystem.config.cjs  PM2 config
deploy/               systemd unit
scripts/              test-connectivity, test-proxy
```

---

## 10. Support contacts

- Server: configure firewall to allow dashboard port (e.g. `3004`)
- Credentials: rotate `API_TOKEN` and proxy passwords regularly
- Sale day: start jobs early; keep server process running; monitor Discord

**Version:** 1.0.0  
**Engine:** HTTP (refer-compatible) + puppeteer-real-browser login
