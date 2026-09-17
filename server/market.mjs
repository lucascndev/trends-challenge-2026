import { readFile, writeFile, mkdir, rename, readdir, rm } from "node:fs/promises";
import {
  day,
  isNum,
  positive,
  marketMetrics,
  historyFile,
} from "../shared/finance.mjs";

// Market data lives as static files under public/ so the same paths serve the
// local server, the production build and GitHub Pages:
//   public/data/market/index.json          quotes without history, FX, status
//   public/data/market/history/<symbol>.json  one year of daily closes per listing
export const marketDir = new URL("../public/data/market/", import.meta.url);
const indexUrl = new URL("index.json", marketDir);
const historyDir = new URL("history/", marketDir);
const historyUrl = (symbol) => new URL(historyFile(symbol), historyDir);
const SPARK = 30;
const timeout = 12000;
const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json",
};
const fetchData = async (url, options = {}) => {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeout),
    ...options,
  });
  if (!response.ok)
    throw new Error(`Provider returned HTTP ${response.status}`);
  return response;
};
const nullable = (n) => (isNum(n) ? n : null);
// Four decimals keep pence and sub-euro quotes exact while halving the history files.
const round4 = (n) => (isNum(n) ? Math.round(n * 1e4) / 1e4 : null);
export const emptyMarket = () => ({
  quotes: {},
  fx: {
    rates: { EUR: 1 },
    history: {},
    date: null,
    source: "ECB reference rates via Frankfurter",
  },
  lastAttempt: null,
  lastSuccess: null,
  errors: [],
  status: "snapshot",
});
export async function readMarket() {
  let index;
  try {
    index = JSON.parse(await readFile(indexUrl, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return emptyMarket();
    throw e;
  }
  const quotes = {};
  for (const [symbol, quote] of Object.entries(index.quotes || {})) {
    let history = [];
    try {
      history = JSON.parse(await readFile(historyUrl(symbol), "utf8")).history;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const { spark, ...rest } = quote;
    quotes[symbol] = { ...rest, history };
  }
  return { ...emptyMarket(), ...index, quotes };
}
const writeAtomic = async (url, data) => {
  await writeFile(new URL(url.href + ".tmp"), JSON.stringify(data));
  await rename(new URL(url.href + ".tmp"), url);
};
export async function writeMarket(data) {
  await mkdir(historyDir, { recursive: true });
  const quotes = {};
  for (const [symbol, quote] of Object.entries(data.quotes)) {
    const { history = [], ...rest } = quote;
    quotes[symbol] = {
      ...rest,
      spark: history.slice(-SPARK).map((p) => p.close),
    };
    await writeAtomic(historyUrl(symbol), { symbol, history });
  }
  const known = new Set(Object.keys(data.quotes).map(historyFile));
  for (const file of await readdir(historyDir))
    if (file.endsWith(".json") && !known.has(file)) await rm(new URL(file, historyDir));
  await writeAtomic(indexUrl, { ...data, quotes });
}
export function parseChart(payload, stock) {
  const chart = payload.chart?.result?.[0];
  if (!chart || payload.chart?.error)
    throw new Error(
      payload.chart?.error?.description || "No price history returned",
    );
  const m = chart.meta;
  const currency = ["GBp", "GBX"].includes(m.currency) ? "GBP" : m.currency;
  if (currency !== stock.currency)
    throw new Error(
      `Currency mismatch: expected ${stock.currency}, provider returned ${m.currency}`,
    );
  // Never silently turn a pence quote into a pounds quote (or vice versa).
  if ((["GBp", "GBX"].includes(m.currency) ? 0.01 : 1) !== stock.quoteScale)
    throw new Error(
      "Quote-unit mismatch; review the listing before using this quote",
    );
  const prices = chart.indicators?.quote?.[0];
  if (
    !prices ||
    !positive(m.regularMarketPrice) ||
    !positive(m.regularMarketTime)
  )
    throw new Error("Incomplete quote");
  const sessionDate = (timestamp) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: m.exchangeTimezoneName || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(timestamp * 1000));
  const priceDate = sessionDate(m.regularMarketTime);
  const history = (chart.timestamp || [])
    .map((t, i) => ({
      date: sessionDate(t),
      close: round4(prices.close?.[i]),
      adjustedClose: round4(chart.indicators?.adjclose?.[0]?.adjclose?.[i]),
      volume: nullable(prices.volume?.[i]),
    }))
    .filter((p) => positive(p.close));
  const asOf = new Date(m.regularMarketTime * 1000).toISOString();
  if (asOf.slice(0, 10) > day())
    throw new Error("Provider returned a future-dated quote");
  // chartPreviousClose is the close before the whole requested range, not yesterday.
  const previous = history.filter((p) => p.date < priceDate).at(-1)?.close;
  return {
    symbol: stock.id,
    price: m.regularMarketPrice,
    currency: m.currency,
    asOf,
    priceDate,
    change: positive(previous)
      ? (m.regularMarketPrice / previous - 1) * 100
      : null,
    high52: nullable(m.fiftyTwoWeekHigh),
    low52: nullable(m.fiftyTwoWeekLow),
    volume: nullable(m.regularMarketVolume),
    history,
    ...marketMetrics(history),
    source: `https://finance.yahoo.com/quote/${encodeURIComponent(stock.id)}/`,
    corporateActions: {
      splits: Object.values(chart.events?.splits || {}),
      dividends: Object.values(chart.events?.dividends || {}),
    },
  };
}
async function chart(stock) {
  const response = await fetchData(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(stock.id)}?range=1y&interval=1d&events=div%2Csplits`,
  );
  return parseChart(await response.json(), stock);
}
// Latest ECB reference rates plus a daily series back to FX_HISTORY_FROM, both as EUR per unit.
const FX_HISTORY_FROM = "2025-09-01";
const invert = (rates) => {
  const out = { EUR: 1 };
  for (const [c, v] of Object.entries(rates || {})) if (positive(v)) out[c] = 1 / v;
  return out;
};
async function fetchFx(previous) {
  const data = await (
    await fetchData("https://api.frankfurter.dev/v1/latest?base=EUR")
  ).json();
  if (data.base !== "EUR" || !data.date || data.date > day())
    throw new Error("Invalid FX reference date or base currency");
  const rates = invert(data.rates);
  if (Object.keys(rates).length < 2) throw new Error("FX rates unavailable");
  let history = { ...(previous?.history || {}) };
  try {
    const known = Object.keys(history).sort();
    const from = known.length ? known.at(-1) : FX_HISTORY_FROM;
    const series = await (
      await fetchData(`https://api.frankfurter.dev/v1/${from}..?base=EUR`)
    ).json();
    for (const [date, r] of Object.entries(series.rates || {}))
      if (date <= data.date) history[date] = invert(r);
  } catch {
    // The latest rate still updates; the series keeps whatever was cached.
  }
  history[data.date] = rates;
  return {
    date: data.date,
    rates,
    history,
    source: "ECB reference rates via Frankfurter",
    url: "https://www.frankfurter.dev/",
  };
}
async function quoteSession() {
  const cookieResponse = await fetch("https://fc.yahoo.com", {
    headers,
    signal: AbortSignal.timeout(timeout),
  });
  const cookie = cookieResponse.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Quote authentication unavailable");
  const crumb = await (
    await fetchData("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      // The crumb is plain text; an application/json Accept header gets HTTP 406.
      headers: { ...headers, Accept: "text/plain, */*", Cookie: cookie },
    })
  ).text();
  if (!crumb || crumb.startsWith("{") || crumb.startsWith("<"))
    throw new Error("Quote authentication unavailable");
  return { cookie, crumb };
}
// Year-over-year growth, margins and returns come from the quoteSummary modules.
async function growth(stock, session) {
  const payload = await (
    await fetchData(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(stock.id)}?modules=financialData%2CdefaultKeyStatistics&crumb=${encodeURIComponent(session.crumb)}`,
      { headers: { ...headers, Cookie: session.cookie } },
    )
  ).json();
  const summary = payload.quoteSummary?.result?.[0];
  if (!summary || payload.quoteSummary?.error)
    throw new Error(
      payload.quoteSummary?.error?.description || "Growth data unavailable",
    );
  const raw = (v) => nullable(v?.raw);
  const pct = (v) => (isNum(raw(v)) ? raw(v) * 100 : null);
  const f = summary.financialData || {},
    k = summary.defaultKeyStatistics || {};
  return {
    revenueGrowth: pct(f.revenueGrowth),
    earningsGrowth: pct(f.earningsGrowth ?? k.earningsQuarterlyGrowth),
    profitMargin: pct(f.profitMargins),
    returnOnEquity: pct(f.returnOnEquity),
    revenue: raw(f.totalRevenue),
    financialCurrency: f.financialCurrency || null,
    growthAsOf: new Date().toISOString(),
  };
}
export async function refreshMarket(
  stocks,
  previous = emptyMarket(),
  onProgress = () => {},
) {
  const result = {
    ...previous,
    quotes: { ...previous.quotes },
    lastAttempt: new Date().toISOString(),
    errors: [],
    status: "refreshing",
  };
  let completed = 0,
    successful = 0;
  const error = (symbol, e) =>
    result.errors.push({
      symbol,
      message:
        e.message === "fetch failed"
          ? "Network connection to provider unavailable"
          : e.message,
    });
  onProgress({
    completed,
    total: stocks.length,
    stage: "Connecting to market sources",
  });
  // Probe once before issuing hundreds of requests when a host is unavailable.
  const probeStock = stocks.find((s) => s.id === "ASML.AS") || stocks[0];
  const [probe, fx] = await Promise.allSettled([
    chart(probeStock),
    fetchFx(previous.fx),
  ]);
  if (fx.status === "fulfilled") result.fx = fx.value;
  else error("FX", fx.reason);
  if (probe.status === "rejected") {
    error(probeStock.id, probe.reason);
    result.status = Object.keys(result.quotes).length
      ? "cached"
      : "unavailable";
    if (fx.status === "fulfilled")
      result.lastSuccess = new Date().toISOString();
    return result;
  }
  result.quotes[probeStock.id] = {
    ...result.quotes[probeStock.id],
    ...probe.value,
  };
  successful++;
  completed++;
  let cursor = 0;
  const remaining = stocks.filter((s) => s.id !== probeStock.id);
  async function worker() {
    while (cursor < remaining.length) {
      const stock = remaining[cursor++];
      try {
        result.quotes[stock.id] = {
          ...result.quotes[stock.id],
          ...(await chart(stock)),
        };
        successful++;
      } catch (e) {
        error(stock.id, e);
      }
      completed++;
      onProgress({
        completed,
        total: stocks.length,
        stage: "Updating prices and daily history",
      });
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  onProgress({
    completed,
    total: stocks.length,
    stage: "Updating market caps and fundamentals",
  });
  try {
    const session = await quoteSession();
    for (let i = 0; i < stocks.length; i += 50) {
      const symbols = stocks
        .slice(i, i + 50)
        .map((s) => s.id)
        .join(",");
      const payload = await (
        await fetchData(
          `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(session.crumb)}`,
          { headers: { ...headers, Cookie: session.cookie } },
        )
      ).json();
      if (!Array.isArray(payload.quoteResponse?.result))
        throw new Error("Fundamentals unavailable");
      for (const q of payload.quoteResponse.result) {
        const stock = stocks.find((s) => s.id === q.symbol),
          current = result.quotes[q.symbol];
        if (!stock || !current) continue;
        const qCurrency = ["GBp", "GBX"].includes(q.currency)
          ? "GBP"
          : q.currency;
        if (qCurrency !== stock.currency) {
          error(q.symbol, new Error("Fundamental currency mismatch"));
          continue;
        }
        const date = positive(q.regularMarketTime)
          ? new Date(q.regularMarketTime * 1000).toISOString()
          : null;
        if (!date || date.slice(0, 10) > day()) continue;
        const earnings = q.earningsTimestampStart || q.earningsTimestamp;
        result.quotes[q.symbol] = {
          ...current,
          marketCap: positive(q.marketCap) ? q.marketCap : null,
          marketCapCurrency: qCurrency,
          marketCapAsOf: positive(q.marketCap) ? date : null,
          pe: nullable(q.trailingPE),
          forwardPe: nullable(q.forwardPE),
          dividendYield: isNum(q.trailingAnnualDividendYield)
            ? q.trailingAnnualDividendYield * 100
            : null,
          earningsDate: positive(earnings)
            ? new Date(earnings * 1000).toISOString().slice(0, 10)
            : null,
          earningsEstimated: q.isEarningsDateEstimate !== false,
          quoteDelayMinutes: nullable(q.exchangeDataDelayedBy),
          epsTrailing: nullable(q.epsTrailingTwelveMonths),
          epsForward: nullable(q.epsForward),
          // Consensus next-twelve-month EPS versus trailing; undefined when either side is a loss.
          epsGrowthForward:
            positive(q.epsForward) && positive(q.epsTrailingTwelveMonths)
              ? (q.epsForward / q.epsTrailingTwelveMonths - 1) * 100
              : null,
          priceToBook: nullable(q.priceToBook),
          fundamentalsAsOf: date,
        };
      }
    }
    onProgress({
      completed: 0,
      total: stocks.length,
      stage: "Updating growth and profitability",
    });
    completed = 0;
    const growthQueue = [...stocks];
    const growthWorker = async () => {
      for (let stock; (stock = growthQueue.shift()); ) {
        const current = result.quotes[stock.id];
        if (current)
          try {
            result.quotes[stock.id] = {
              ...current,
              ...(await growth(stock, session)),
            };
          } catch (e) {
            error(stock.id, e);
          }
        onProgress({
          completed: ++completed,
          total: stocks.length,
          stage: "Updating growth and profitability",
        });
      }
    };
    await Promise.all([growthWorker(), growthWorker(), growthWorker()]);
  } catch (e) {
    error("Fundamentals", e);
  }
  result.lastSuccess = successful
    ? new Date().toISOString()
    : previous.lastSuccess;
  result.status = result.errors.length ? "partial" : "updated";
  return result;
}
