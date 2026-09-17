# The Challenge — Investment Desk 2026

Research and portfolio dashboard for the **5 October–27 November 2026** Trends Investment Challenge. Rules applied by the app: **€100,000**, **5–20 stocks**, **no stock above 25% of capital**, long only. The 566-stock CSV is the eligibility universe.

## Run locally

Requires Node.js 22+ (24 recommended).

```powershell
npm install
npm run dev
```

Open **http://localhost:3000**. Production build:

```powershell
npm run build
npm start
```

The server binds to localhost; set `PORT` for another port. Keep using the same origin: the plan and journal live in that origin's browser storage.

## Pages

- **Performance** (home). Before the first journal entry: the plan priced at the latest close, a 63-session "what the plan would have returned" curve, estimated whole shares, day/21/63-session moves, next earnings dates, sector and currency exposure. Once trades are recorded: portfolio value, return on €100,000, cash, realized P&L, a daily value curve since the first trade (each session's close and that day's ECB rate), holdings with weights and P&L, and rule warnings (fewer than 5 holdings, a holding above 25%).
- **Screener.** Search all 566 listings; filter by sector, currency, exchange, EUR market-cap band and momentum; sort; watchlist; CSV export. Open a stock for one year of daily history, returns, volatility, valuation, estimated earnings date, source links and notes. Compare up to four.
- **Portfolio.** *Allocation plan:* 5–20 stocks, target weights, equal-weight helper, rule check (min/max positions, 25% cap, total ≤ 100%), backup and restore. *Trade journal:* from 5 October, record actual fills with execution FX and fees; buys, sells, net distributions and splits. Rejects shorts, borrowing, a 21st holding, and any buy that takes a position above 25% of the portfolio at cost. Warns while fewer than 5 stocks are held.

Nothing is sent to the challenge account or a broker.

## Market data

**Refresh all** fetches one year of daily Yahoo Finance history for every listing plus market caps, P/E, dividend yields and earnings dates. **Refresh my N stocks** does the same for only the stocks in the plan and journal, which takes seconds instead of minutes. ECB reference rates (latest and a daily series from September 2025) come from Frankfurter. No API key is needed; Yahoo's endpoints are unofficial and can fail or be delayed, and the UI shows dated values when they do.

Data is stored as static files so the same build works locally and on GitHub Pages:

- `public/data/market/index.json` — quotes, fundamentals, FX, refresh status (no history)
- `public/data/market/history/<symbol>.json` — daily closes, loaded per stock on demand

The local server refreshes at startup if the last attempt was on an earlier Brussels date, and nightly after 22:15 UTC. Set `AUTO_REFRESH=0` to disable that. From the command line:

```powershell
npm run data:refresh                          # everything
npm run data:refresh -- --symbols=AMD,ASML.AS # a subset
```

Do not run the CLI and an in-app refresh at the same time.

## GitHub Pages

`.github/workflows/pages.yml` does three things in one job: refresh prices, commit the data files, build and deploy.

1. In the repository settings, set **Pages → Source** to **GitHub Actions**.
2. Push to `main`. The push run builds and deploys without refreshing.
3. Every weekday at 22:30 UTC the scheduled run refreshes all 566 listings, commits `public/data/market`, and redeploys.

The site is built with `BASE_PATH=/<repo>/` (or `/` for a `*.github.io` repository) and `VITE_GITHUB_REPOSITORY` so the static page knows where it lives.

**Refreshing from the static site.** There is no server on Pages and Yahoo blocks browser requests, so the Refresh buttons start the workflow instead: the app calls the GitHub API's `workflow_dispatch` with the symbols to refresh, the run commits new prices and redeploys, and the page picks them up within a few minutes. The first time, the app asks for a **fine-grained personal access token** with **Actions: read and write** on the repository; it can be remembered in the browser or entered each time. Manual runs are also possible from the Actions tab, with an optional comma-separated symbol list.

## Accounting

- EUR position value = shares × quoted price × quote scale × EUR-per-currency rate. GBp quotes carry a 0.01 scale; GBP market caps do not.
- Journal sales use average EUR cost. Fees default to zero. Distributions and splits are entered explicitly.
- The 25% purchase limit compares the position's cost after the buy with cash plus the cost of all holdings. The Performance page additionally flags holdings above 25% at market value.
- The daily value curve uses the last close on or before each session and the ECB rate on or before that day; sessions with a missing input are drawn hollow.
- Values older than four calendar days are flagged as stale.
- Plan, watchlist, notes and journal are in `localStorage`. Download a backup from the Portfolio page.

## Data cleanup

```powershell
npm run data:clean
```

Preserves the raw CSV and writes `public/data/stocks-cleaned.csv`, `public/data/universe.json` and `data/quality-report.json`. All 566 rows are kept (19 exchanges, 11 sectors, 9 currencies; 11 unconfirmed share classes, 17 pence quotes, 2 missing caps). Cleaning normalizes text and numbers and keeps missing values as null; it does not invent prices or dates.

## Verification

```powershell
npm test          # CSV, currency units, ledger, rule limits, series, provider parsing
npm run build
```

Browser tests need a running server and Playwright's Chromium:

```powershell
npx playwright install chromium
npm run test:browser
```

They cover the plan and 25% rule, journal executions and rejections, the performance page, splits, distributions, backup/restore, and desktop/mobile layout. Screenshots go to the ignored `test-results/` directory. Tests use isolated browser storage and fixtures; they do not touch the real plan or data files.

Stack: React, Vite, Tailwind CSS, Base UI dialogs, a dependency-light Node server for local use, GitHub Actions for Pages.
