import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCsv, toCsv } from "../shared/csv.mjs";
import {
  priceToEur,
  capToEur,
  validateDraft,
  equalWeight,
  ledger,
  validateTrade,
  valuePortfolio,
  marketMetrics,
  phase,
  portfolioSeries,
  draftSeries,
  sinceAdded,
  fxOn,
  CAPITAL,
} from "../shared/finance.mjs";
import { parseChart, emptyMarket, refreshMarket } from "../server/market.mjs";
const { stocks, report } = JSON.parse(
  await readFile(
    new URL("../public/data/universe.json", import.meta.url),
    "utf8",
  ),
);
const euro = stocks.find((s) => s.id === "ASML.AS"),
  uk = stocks.find((s) => s.id === "AZN.L"),
  us = stocks.find((s) => s.id === "AAPL");
const date = "2026-10-08";
const trade = (overrides = {}) => ({
  id: euro.id,
  date,
  type: "buy",
  shares: 10,
  price: 100,
  fx: 1,
  fee: 2,
  sequence: 1,
  ...overrides,
});
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("CSV cleaning reconciles every eligible listing and preserves provenance", async () => {
  const raw = parseCsv(
    await readFile(
      new URL("../trends-invest-challenge-stock-lookup.csv", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(stocks.length, 566);
  assert.equal(report.rowsRead, 566);
  assert.equal(new Set(stocks.map((s) => s.id)).size, 566);
  assert.equal(
    stocks.filter((s) => s.flags.includes("share-class")).length,
    11,
  );
  assert.equal(stocks.filter((s) => s.marketCap === null).length, 2);
  assert.equal(stocks.filter((s) => s.quoteScale === 0.01).length, 17);
  for (const s of stocks) {
    const r = raw[s.sourceRow - 2];
    assert.equal(s.id, r.yahoo_symbol);
    assert.equal(s.sources.marketCap, r.market_cap_source_url);
    assert.equal(
      s.marketCap,
      r.market_cap === "" ? null : Number(r.market_cap),
    );
  }
});
test("CSV handles quoted commas, multiline fields, escaped quotes and missing values", () => {
  const records = parseCsv(
    'name,note,value\r\n"A, B","Two ""words""\nnext line",\r\n',
  );
  assert.equal(records[0].note, 'Two "words"\nnext line');
  assert.equal(records[0].value, "");
  assert.deepEqual(parseCsv(toCsv(records)), records);
  assert.match(toCsv([{ note: '=HYPERLINK("bad")' }]), /'=HYPERLINK/);
  assert.throws(() => parseCsv("a,b\n1"), /expected 2/);
});
test("Pence prices scale by 0.01, GBP caps do not, missing FX is not zero", () => {
  approx(priceToEur(10000, uk, { rates: { GBP: 1.2 } }), 120);
  approx(capToEur(uk, null, { rates: { GBP: 1.2 } }), uk.marketCap * 1.2);
  assert.equal(priceToEur(100, us, { rates: { EUR: 1 } }), null);
  assert.equal(capToEur(us, null, { rates: { EUR: 1 } }), null);
  assert.equal(priceToEur(100, euro, {}), 100);
});
test("Equal weights sum exactly to 100 and respect position and cash limits", () => {
  const draft = equalWeight(
    stocks.slice(0, 7).map((s) => ({ id: s.id, weight: 0 })),
  );
  approx(validateDraft(draft).total, 100);
  assert.ok(validateDraft(draft).valid);
  assert.equal(validateDraft(draft.slice(0, 4)).valid, false);
  assert.equal(
    validateDraft([...draft, { id: draft[0].id, weight: 1 }]).valid,
    false,
  );
  assert.equal(
    validateDraft(draft.map((s) => ({ ...s, weight: 30 }))).valid,
    false,
  );
  assert.equal(
    validateDraft(draft.map((s) => ({ ...s, weight: -1 }))).valid,
    false,
  );
});
test("Long-only ledger reconciles EUR cash, average-cost partial sales and fees", () => {
  const rows = [
    trade(),
    trade({ type: "buy", shares: 10, price: 200, fee: 0, sequence: 2 }),
    trade({ type: "sell", shares: 5, price: 250, fee: 3, sequence: 3 }),
  ];
  const b = ledger(rows, stocks);
  approx(b.cash, 98245);
  approx(b.holdings[0].shares, 15);
  approx(b.holdings[0].cost, 2251.5);
  approx(b.realized, 496.5);
  approx(b.fees, 5);
  assert.match(
    validateTrade(trade({ type: "sell", shares: 21 }), rows, stocks, date),
    /more shares/,
  );
  assert.match(
    validateTrade(trade({ shares: 10000 }), [], stocks, date),
    /exceeds available/,
  );
  assert.match(
    validateTrade(trade({ shares: 1.5 }), [], stocks, date),
    /whole/,
  );
});
test("Execution guard enforces dates, eligibility, share-class acknowledgement, FX and 20 holdings", () => {
  assert.match(
    validateTrade(trade({ date: "2026-10-04" }), [], stocks, date),
    /between/,
  );
  assert.match(
    validateTrade(trade({ date: "2026-10-09" }), [], stocks, date),
    /Future/,
  );
  assert.match(
    validateTrade(trade({ id: "NOT-ELIGIBLE" }), [], stocks, date),
    /eligible/,
  );
  assert.match(
    validateTrade(trade({ id: "GOOG" }), [], stocks, date),
    /share class/,
  );
  assert.match(validateTrade(trade({ fx: 2 }), [], stocks, date), /FX/);
  const rows = stocks
    .slice(0, 20)
    .map((s, i) =>
      trade({ id: s.id, price: 1, shares: 1, fee: 0, sequence: i + 1 }),
    );
  assert.match(
    validateTrade(trade({ id: stocks[21].id }), rows, stocks, date),
    /at most 20/,
  );
});
test("Splits preserve cost basis; distributions reconcile cash and P&L", () => {
  const rows = [
    trade({ id: uk.id, price: 10000, fx: 1.2, fee: 0 }),
    trade({ id: uk.id, type: "split", ratio: 2, sequence: 2 }),
    trade({ id: uk.id, type: "dividend", amount: 25, sequence: 3 }),
  ];
  const b = ledger(rows, stocks);
  approx(b.cash, 98825);
  approx(b.holdings[0].shares, 20);
  approx(b.holdings[0].cost, 1200);
  approx(b.realized, 25);
});
test("Incomplete marks never masquerade as a loss; stale marks are exposed", () => {
  const rows = [trade({ id: us.id, fx: 0.9 })];
  assert.equal(valuePortfolio(rows, stocks, emptyMarket(), date).value, null);
  const market = {
    quotes: { [us.id]: { price: 110, asOf: "2026-10-01T20:00:00Z" } },
    fx: { rates: { USD: 0.8 }, date },
  };
  const b = valuePortfolio(rows, stocks, market, date);
  approx(b.value, 99978);
  assert.deepEqual(b.outdated, [us.id]);
});
test("Momentum needs enough observations and uses adjusted returns when complete", () => {
  const history = Array.from({ length: 64 }, (_, i) => ({
    close: 100 + i,
    adjustedClose: 50 + i,
    volume: 100,
  }));
  const m = marketMetrics(history);
  approx(m.return63, (113 / 50 - 1) * 100);
  assert.equal(m.volume20, 100);
  assert.ok(m.volatility > 0);
  // 50-session average of adjusted closes 64..113, and no 100-session average from 64 rows.
  approx(m.ma50, (64 + 113) / 2);
  approx(m.aboveMa50, (113 / 88.5 - 1) * 100);
  assert.equal(m.ma100, null);
  assert.equal(m.aboveMa200, null);
  assert.equal(marketMetrics(history.slice(0, 5)).return5, null);
  assert.equal(marketMetrics(history.slice(0, 5)).volatility, null);
  assert.equal(
    marketMetrics(history.map((p) => ({ ...p, adjustedClose: null })))
      .returnBasis,
    "Close (unadjusted)",
  );
});
test("Chart uses prior daily close, not the previous close before the one-year range", () => {
  const times = [
    "2026-09-14T08:00:00Z",
    "2026-09-15T08:00:00Z",
    "2026-09-16T08:00:00Z",
  ].map((d) => Date.parse(d) / 1000);
  const payload = {
    chart: {
      result: [
        {
          meta: {
            currency: "EUR",
            regularMarketPrice: 110,
            regularMarketTime: times[2] + 3600,
            chartPreviousClose: 50,
          },
          timestamp: times,
          indicators: { quote: [{ close: [99, 100, 110], volume: [1, 2, 3] }] },
        },
      ],
    },
  };
  approx(parseChart(payload, euro).change, 10);
  payload.chart.result[0].meta.currency = "USD";
  assert.throws(() => parseChart(payload, euro), /Currency mismatch/);
});
test("Provider connection failure preserves previous data and marks the failed attempt", async () => {
  const previous = {
    ...emptyMarket(),
    quotes: { TEST: { price: 4, asOf: "2026-09-01T00:00:00Z" } },
    lastSuccess: "2026-09-01T00:00:00Z",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };
  try {
    const result = await refreshMarket([euro], previous);
    assert.equal(result.quotes.TEST.price, 4);
    assert.equal(result.lastSuccess, previous.lastSuccess);
    assert.equal(result.status, "cached");
    assert.equal(result.errors.length, 2);
    assert.ok(result.lastAttempt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("Competition date boundaries are explicit", () => {
  assert.equal(phase("2026-09-17").days, 18);
  assert.equal(phase("2026-10-05").week, 1);
  assert.equal(phase("2026-11-27").week, 8);
  assert.equal(phase("2026-11-28").label, "Finished");
});
test("Full provider pipeline refreshes FX and never re-dates a missing cap", async () => {
  const timestamp = Date.parse("2026-09-16T15:30:00Z") / 1000;
  const previous = {
    ...emptyMarket(),
    quotes: {
      [euro.id]: { marketCap: 123, marketCapAsOf: "2026-09-01T00:00:00Z" },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes("frankfurter"))
      return Response.json({
        base: "EUR",
        date: "2026-09-16",
        rates: { USD: 1.25, GBP: 0.8 },
      });
    if (url.includes("/chart/"))
      return Response.json({
        chart: {
          result: [
            {
              meta: {
                currency: "EUR",
                regularMarketPrice: 110,
                regularMarketTime: timestamp,
                exchangeTimezoneName: "Europe/Amsterdam",
              },
              timestamp: [timestamp - 86400, timestamp],
              indicators: {
                quote: [{ close: [100, 110], volume: [100, 120] }],
              },
            },
          ],
        },
      });
    if (url === "https://fc.yahoo.com")
      return new Response("", { headers: { "Set-Cookie": "B=test; Path=/" } });
    if (url.includes("getcrumb")) return new Response("test-crumb");
    if (url.includes("/quote?"))
      return Response.json({
        quoteResponse: {
          result: [
            {
              symbol: euro.id,
              currency: "EUR",
              regularMarketTime: timestamp,
              marketCap: null,
              trailingPE: 24,
              epsTrailingTwelveMonths: 4,
              epsForward: 5,
              earningsTimestamp: Date.parse("2026-10-14T10:00:00Z") / 1000,
            },
          ],
        },
      });
    if (url.includes("/quoteSummary/"))
      return Response.json({
        quoteSummary: {
          result: [
            {
              financialData: {
                revenueGrowth: { raw: 0.213 },
                earningsGrowth: { raw: 0.285 },
                profitMargins: { raw: 0.3 },
                financialCurrency: "EUR",
              },
              defaultKeyStatistics: { earningsQuarterlyGrowth: { raw: 0.27 } },
            },
          ],
        },
      });
    throw new Error("Unexpected fixture URL");
  };
  try {
    const result = await refreshMarket([euro], previous);
    assert.equal(result.status, "updated");
    approx(result.fx.rates.USD, 0.8);
    assert.equal(result.quotes[euro.id].marketCapAsOf, null);
    assert.equal(result.quotes[euro.id].marketCap, null);
    assert.equal(result.quotes[euro.id].pe, 24);
    assert.equal(result.quotes[euro.id].earningsDate, "2026-10-14");
    assert.equal(result.quotes[euro.id].history.length, 2);
    approx(result.quotes[euro.id].epsGrowthForward, 25);
    approx(result.quotes[euro.id].revenueGrowth, 21.3);
    approx(result.quotes[euro.id].earningsGrowth, 28.5);
    assert.equal(result.quotes[euro.id].financialCurrency, "EUR");
    assert.equal(result.errors.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("Daily change respects the exchange session date across UTC midnight", () => {
  const times = ["2026-09-14T23:00:00Z", "2026-09-15T23:00:00Z"].map(
    (d) => Date.parse(d) / 1000,
  );
  const payload = {
    chart: {
      result: [
        {
          meta: {
            currency: "AUD",
            exchangeTimezoneName: "Australia/Sydney",
            regularMarketPrice: 11,
            regularMarketTime: Date.parse("2026-09-16T05:00:00Z") / 1000,
          },
          timestamp: times,
          indicators: { quote: [{ close: [10, 11], volume: [100, 100] }] },
        },
      ],
    },
  };
  const q = parseChart(payload, { ...euro, currency: "AUD" });
  assert.equal(q.priceDate, "2026-09-16");
  approx(q.change, 10);
});
test("A split-created fractional residual can be closed, and fees cannot overdraw a sale", () => {
  const rows = [
    trade({ shares: 3, fee: 0 }),
    trade({ type: "split", ratio: 0.5, sequence: 2 }),
  ];
  assert.equal(
    validateTrade(trade({ type: "sell", shares: 1.5 }), rows, stocks, date),
    null,
  );
  assert.match(
    validateTrade(trade({ type: "sell", shares: 0.5 }), rows, stocks, date),
    /Fractional/,
  );
  assert.match(
    validateTrade(
      trade({ type: "sell", shares: 1, fee: 200000 }),
      rows,
      stocks,
      date,
    ),
    /cover the entered fee/,
  );
});

test("No planned position may exceed 25% of capital", () => {
  const five = stocks.slice(0, 5).map((s) => ({ id: s.id, weight: 20 }));
  assert.ok(validateDraft(five).valid);
  const skewed = five.map((p, i) => ({ ...p, weight: i ? 15 : 30 }));
  const result = validateDraft(skewed);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((m) => m.includes("25%")));
  assert.ok(validateDraft(five.map((p, i) => ({ ...p, weight: i ? 18.75 : 25 }))).valid);
});
test("A buy that takes a position above 25% of the book at cost is rejected", () => {
  // 260 shares × 100 EUR = 26,000 > 25% of 100,000.
  assert.match(
    validateTrade(trade({ shares: 260, price: 100, fee: 0 }), [], stocks, date),
    /25%/,
  );
  assert.equal(
    validateTrade(trade({ shares: 250, price: 100, fee: 0 }), [], stocks, date),
    null,
  );
  // Topping up an existing 20,000 position by 6,000 crosses the limit too.
  const first = trade({ shares: 200, price: 100, fee: 0 });
  assert.match(
    validateTrade(
      trade({ shares: 60, price: 100, fee: 0, sequence: 2 }),
      [first],
      stocks,
      date,
    ),
    /25%/,
  );
  // Selling never triggers the limit.
  assert.equal(
    validateTrade(
      trade({ type: "sell", shares: 50, price: 100, fee: 0, sequence: 2 }),
      [first],
      stocks,
      date,
    ),
    null,
  );
});
test("FX lookup uses the last ECB rate on or before the date", () => {
  const fx = {
    rates: { EUR: 1, USD: 0.9 },
    history: { "2026-10-05": { USD: 0.85 }, "2026-10-07": { USD: 0.86 } },
  };
  assert.equal(fxOn("EUR", "2026-10-06", fx), 1);
  assert.equal(fxOn("USD", "2026-10-06", fx), 0.85);
  assert.equal(fxOn("USD", "2026-10-08", fx), 0.86);
  assert.equal(fxOn("USD", "2026-10-01", fx), 0.9);
  assert.equal(fxOn("GBP", "2026-10-08", fx), null);
});
test("Daily portfolio series marks sessions to close and flags missing inputs", () => {
  const trades = [
    trade({ id: euro.id, date: "2026-10-05", shares: 100, price: 100, fee: 0 }),
    trade({
      id: us.id,
      date: "2026-10-06",
      shares: 10,
      price: 200,
      fx: 0.9,
      fee: 0,
      sequence: 2,
    }),
  ];
  const histories = {
    [euro.id]: [
      { date: "2026-10-05", close: 100 },
      { date: "2026-10-06", close: 110 },
      { date: "2026-10-07", close: 120 },
    ],
    [us.id]: [
      { date: "2026-10-06", close: 200 },
      { date: "2026-10-07", close: 220 },
    ],
  };
  const fx = {
    rates: { EUR: 1, USD: 0.9 },
    history: { "2026-10-06": { USD: 0.9 }, "2026-10-07": { USD: 1 } },
  };
  const series = portfolioSeries(trades, stocks, histories, fx, "2026-10-09");
  assert.deepEqual(
    series.map((p) => p.date),
    ["2026-10-05", "2026-10-06", "2026-10-07"],
  );
  approx(series[0].value, CAPITAL);
  approx(series[1].value, 90000 - 1800 + 11000 + 1800);
  approx(series[2].value, 88200 + 12000 + 2200);
  assert.ok(series.every((p) => p.complete));
  const gap = portfolioSeries(
    trades,
    stocks,
    { ...histories, [us.id]: [] },
    fx,
    "2026-10-09",
  );
  assert.equal(gap[2].complete, false);
});
test("Plan series starts at the first pick; later picks enter on their add date", () => {
  const draft = [
    { id: euro.id, weight: 25, added: "2026-09-01" },
    { id: us.id, weight: 25, added: "2026-09-02" },
  ];
  const histories = {
    [euro.id]: [
      { date: "2026-09-01", close: 100 },
      { date: "2026-09-02", close: 110 },
      { date: "2026-09-03", close: 120 },
    ],
    [us.id]: [
      { date: "2026-09-01", close: 40 },
      { date: "2026-09-02", close: 50 },
      { date: "2026-09-03", close: 55 },
    ],
  };
  const fx = { rates: { EUR: 1, USD: 0.9 }, history: {} };
  const series = draftSeries(draft, stocks, histories, fx, "2026-09-03");
  assert.deepEqual(
    series.map((p) => p.date),
    ["2026-09-01", "2026-09-02", "2026-09-03"],
  );
  approx(series[0].value, CAPITAL);
  // Day 2: euro +10%; the US pick enters today at 50, so it is still flat.
  approx(series[1].value, CAPITAL * (0.5 + 0.25 * 1.1 + 0.25));
  // Day 3: euro +20% from 100, US +10% from 50.
  approx(series[2].value, CAPITAL * (0.5 + 0.25 * 1.2 + 0.25 * 1.1));
  assert.ok(series.every((p) => p.complete));
  approx(sinceAdded(draft[0], euro, histories[euro.id], fx), 20);
  approx(sinceAdded(draft[1], us, histories[us.id], fx), 10);
  assert.equal(sinceAdded({ id: us.id, weight: 1 }, us, histories[us.id], fx), null);
  assert.deepEqual(draftSeries([], stocks, histories, fx), []);
  // Entries without an add date are ignored rather than guessed.
  assert.deepEqual(
    draftSeries([{ id: euro.id, weight: 25 }], stocks, histories, fx),
    [],
  );
});
