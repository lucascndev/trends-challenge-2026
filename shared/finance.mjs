export const START = "2026-10-05";
export const END = "2026-11-27";
export const CAPITAL = 100000;
export const MIN_POSITIONS = 5;
export const MAX_POSITIONS = 20;
// Largest single position, as a percentage of capital.
export const MAX_WEIGHT = 25;
// History file name for a listing. Windows refuses files whose base name is a
// device name (CON.DE would become the console), so those get a prefix.
export const historyFile = (symbol) =>
  (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(symbol) ? "_" : "") +
  encodeURIComponent(symbol) +
  ".json";
export const isNum = (n) => typeof n === "number" && Number.isFinite(n);
export const positive = (n) => isNum(n) && n > 0;
export const day = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const daysBetween = (a, b) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const stale = (date, now = day(), maxDays = 4) =>
  !date || daysBetween(date.slice(0, 10), now) > maxDays;
export function phase(today = day()) {
  if (today < START)
    return { label: "Preparation", days: daysBetween(today, START), week: 0 };
  if (today > END) return { label: "Finished", days: 0, week: 8 };
  return {
    label: "In progress",
    days: daysBetween(today, END),
    week: Math.min(8, 1 + Math.floor(daysBetween(START, today) / 7)),
  };
}
export function priceToEur(price, stock, fx) {
  const rate = stock.currency === "EUR" ? 1 : fx?.rates?.[stock.currency];
  return positive(price) && positive(rate)
    ? price * stock.quoteScale * rate
    : null;
}
export function capToEur(stock, quote, fx) {
  const cap = positive(quote?.marketCap) ? quote.marketCap : stock.marketCap;
  const currency = positive(quote?.marketCap)
    ? quote.marketCapCurrency || stock.marketCapCurrency
    : stock.marketCapCurrency;
  const rate = currency === "EUR" ? 1 : fx?.rates?.[currency];
  return positive(cap) && positive(rate) ? cap * rate : null;
}
export function marketMetrics(history) {
  const rows = history.filter((p) => positive(p.close));
  // Use adjusted closes only when the provider supplies a complete adjusted series.
  const adjusted =
    rows.length > 0 && rows.every((p) => positive(p.adjustedClose));
  const prices = rows.map((p) => (adjusted ? p.adjustedClose : p.close));
  const ret = (n) =>
    prices.length > n ? (prices.at(-1) / prices.at(-1 - n) - 1) * 100 : null;
  const logs = prices
    .slice(-21)
    .slice(1)
    .map((p, i) => Math.log(p / prices.slice(-21)[i]));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const volatility =
    logs.length === 20
      ? Math.sqrt(
          logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1),
        ) *
        Math.sqrt(252) *
        100
      : null;
  const volumes = rows
    .slice(-20)
    .map((p) => p.volume)
    .filter(isNum);
  const volume20 =
    volumes.length === 20 ? volumes.reduce((a, b) => a + b, 0) / 20 : null;
  const drawdown = prices.length
    ? (prices.at(-1) / Math.max(...prices) - 1) * 100
    : null;
  // Simple moving averages need a full window; the gap is the last price versus the average.
  const average = (n) =>
    prices.length >= n
      ? prices.slice(-n).reduce((a, b) => a + b, 0) / n
      : null;
  const gap = (avg) => (avg === null ? null : (prices.at(-1) / avg - 1) * 100);
  const ma20 = average(20),
    ma50 = average(50),
    ma100 = average(100),
    ma200 = average(200);
  return {
    return5: ret(5),
    return21: ret(21),
    return63: ret(63),
    return126: ret(126),
    volatility,
    volume20,
    drawdown,
    ma20,
    ma50,
    ma100,
    ma200,
    aboveMa20: gap(ma20),
    aboveMa50: gap(ma50),
    aboveMa100: gap(ma100),
    aboveMa200: gap(ma200),
    returnBasis: adjusted ? "Adjusted close" : "Close (unadjusted)",
  };
}
export function validateDraft(draft) {
  const issues = [];
  if (draft.length < MIN_POSITIONS || draft.length > MAX_POSITIONS)
    issues.push(`Choose between ${MIN_POSITIONS} and ${MAX_POSITIONS} stocks.`);
  if (new Set(draft.map((p) => p.id)).size !== draft.length)
    issues.push("Each stock may appear only once.");
  if (draft.some((p) => !positive(p.weight) || p.weight > 100))
    issues.push("Every allocation must be greater than 0% and at most 100%.");
  if (draft.some((p) => isNum(p.weight) && p.weight > MAX_WEIGHT + 1e-9))
    issues.push(`No single stock may exceed ${MAX_WEIGHT}% of capital.`);
  const total = draft.reduce(
    (sum, p) => sum + (isNum(p.weight) ? p.weight : 0),
    0,
  );
  if (total > 100.00001)
    issues.push("Allocations exceed the available capital.");
  return {
    issues,
    total,
    cash: CAPITAL * (1 - total / 100),
    valid: issues.length === 0,
  };
}
export function equalWeight(draft, invested = 100) {
  if (!draft.length) return [];
  const units = Math.floor((invested * 100) / draft.length);
  return draft.map((p, i) => ({
    ...p,
    weight:
      (units +
        (i < Math.round(invested * 100) - units * draft.length ? 1 : 0)) /
      100,
  }));
}
export function ledger(trades, stocks) {
  let cash = CAPITAL,
    realized = 0,
    fees = 0;
  const holdings = {};
  const byId = Object.fromEntries(stocks.map((s) => [s.id, s]));
  for (const t of [...trades].sort(
    (a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence,
  )) {
    const s = byId[t.id];
    if (!s) throw new Error("This listing is outside the eligible universe.");
    const h = (holdings[t.id] ||= { id: t.id, shares: 0, cost: 0 });
    if (t.type === "split") {
      h.shares *= t.ratio;
      continue;
    }
    if (t.type === "dividend") {
      cash += t.amount;
      realized += t.amount;
      continue;
    }
    const gross = t.shares * t.price * s.quoteScale * t.fx;
    const fee = t.fee || 0;
    fees += fee;
    if (t.type === "buy") {
      cash -= gross + fee;
      h.shares += t.shares;
      h.cost += gross + fee;
    } else {
      const basis = h.shares > 0 ? (h.cost * t.shares) / h.shares : 0;
      cash += gross - fee;
      h.shares -= t.shares;
      h.cost -= basis;
      realized += gross - fee - basis;
    }
    if (cash < -0.005 || h.shares < -0.000001)
      throw new Error(
        "This entry would overdraw cash or create a short position.",
      );
  }
  return {
    cash,
    realized,
    fees,
    holdings: Object.values(holdings).filter((h) => h.shares > 0.000001),
  };
}
export function validateTrade(t, trades, stocks, today = day()) {
  const s = stocks.find((s) => s.id === t.id);
  if (!s) return "Choose an eligible stock.";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(t.date) ||
    !Number.isFinite(Date.parse(t.date))
  )
    return "Enter a valid date.";
  if (t.date < START || t.date > END)
    return "Trade dates must fall between 5 October and 27 November 2026.";
  if (t.date > today)
    return "Future trades cannot be recorded. Use the allocation planner before the competition starts.";
  if (trades.some((x) => x.date > t.date))
    return "Record entries in date order to preserve the cash and holdings ledger.";
  if (s.flags.includes("share-class") && !t.listingChecked)
    return "Check the exact share class against the challenge before recording a trade.";
  let book;
  try {
    book = ledger(trades, stocks);
  } catch (e) {
    return e.message;
  }
  const h = book.holdings.find((h) => h.id === t.id);
  if (t.type === "split")
    return !h
      ? "A split requires an existing holding."
      : !positive(t.ratio)
        ? "Enter a positive new-shares / old-shares ratio."
        : null;
  if (t.type === "dividend")
    return !positive(t.amount)
      ? "Enter the net cash distribution in EUR."
      : !h
        ? "A distribution requires an existing holding."
        : null;
  if (!["buy", "sell"].includes(t.type)) return "Choose buy or sell.";
  if (
    !positive(t.shares) ||
    (t.type === "buy" && !Number.isSafeInteger(t.shares))
  )
    return "Enter a positive whole number of shares for purchases.";
  if (
    t.type === "sell" &&
    !Number.isSafeInteger(t.shares) &&
    (!h || Math.abs(t.shares - h.shares) > 1e-8)
  )
    return "Fractional sales can only close the entire residual holding after a split.";
  if (!positive(t.price))
    return "Enter a positive execution price in the displayed quote units.";
  if (!positive(t.fx) || (s.currency === "EUR" && t.fx !== 1))
    return "Enter the execution FX rate in EUR per 1 unit of currency (EUR = 1).";
  if (!isNum(t.fee) || t.fee < 0)
    return "Fees must be zero or a positive EUR amount.";
  if (t.type === "sell" && (!h || t.shares > h.shares + 1e-8))
    return "You cannot sell more shares than you hold.";
  if (t.type === "buy" && !h && book.holdings.length >= MAX_POSITIONS)
    return `The portfolio can hold at most ${MAX_POSITIONS} different stocks.`;
  const cost = t.shares * t.price * s.quoteScale * t.fx + t.fee;
  if (!Number.isFinite(cost)) return "The execution amount is too large.";
  if (t.type === "buy" && cost > book.cash + 0.005)
    return "This purchase exceeds available EUR cash.";
  // The 25% limit is checked at cost: the position's cost after this buy
  // against cash plus the cost of every holding.
  if (t.type === "buy") {
    const invested = book.holdings.reduce((sum, x) => sum + x.cost, 0);
    const limit = ((book.cash + invested) * MAX_WEIGHT) / 100;
    if ((h?.cost || 0) + cost > limit + 0.005)
      return `This purchase would take ${s.id} above ${MAX_WEIGHT}% of the portfolio (limit ${Math.floor(limit)} EUR at cost).`;
  }
  if (
    t.type === "sell" &&
    book.cash + t.shares * t.price * s.quoteScale * t.fx < t.fee - 0.005
  )
    return "The sale proceeds and cash cannot cover the entered fee.";
  return null;
}
export function valuePortfolio(trades, stocks, market, today = day()) {
  const book = ledger(trades, stocks);
  let value = book.cash;
  const missing = [],
    outdated = [];
  const holdings = book.holdings.map((h) => {
    const s = stocks.find((s) => s.id === h.id),
      q = market.quotes?.[h.id];
    const eur = priceToEur(q?.price, s, market.fx);
    if (eur === null) missing.push(h.id);
    else {
      value += eur * h.shares;
      if (
        stale(q?.asOf, today) ||
        (s.currency !== "EUR" && stale(market.fx?.date, today))
      )
        outdated.push(h.id);
    }
    return {
      ...h,
      value: eur === null ? null : eur * h.shares,
      pnl: eur === null ? null : eur * h.shares - h.cost,
    };
  });
  return {
    ...book,
    holdings,
    value: missing.length ? null : value,
    missing,
    outdated,
  };
}

const isWeekend = (date) => [0, 6].includes(new Date(date + "T12:00:00Z").getUTCDay());
const addDays = (date, n) =>
  new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
// EUR per unit of currency on a date: the last ECB reference rate on or before it.
export function fxOn(currency, date, fx) {
  if (currency === "EUR") return 1;
  const history = fx?.history;
  if (history) {
    const dates = Object.keys(history)
      .filter((d) => d <= date)
      .sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      const rate = history[dates[i]]?.[currency];
      if (positive(rate)) return rate;
    }
  }
  return positive(fx?.rates?.[currency]) ? fx.rates[currency] : null;
}
const closeOn = (history, date) => {
  let close = null;
  for (const p of history) {
    if (p.date > date) break;
    if (positive(p.close)) close = p.close;
  }
  return close;
};
// Daily EUR value of the journal from the first trade to the last priced session.
// Each point marks whether every holding had a close and an FX rate on or before that day.
export function portfolioSeries(trades, stocks, histories, fx, today = day()) {
  if (!trades.length) return [];
  const sorted = [...trades].sort(
    (a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence,
  );
  const byId = Object.fromEntries(stocks.map((s) => [s.id, s]));
  const last = today < END ? today : END;
  const points = [];
  for (let d = sorted[0].date; d <= last; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    const book = ledger(
      sorted.filter((t) => t.date <= d),
      stocks,
    );
    let value = book.cash,
      complete = true;
    for (const h of book.holdings) {
      const s = byId[h.id];
      const close = closeOn(histories[h.id] || [], d),
        rate = fxOn(s.currency, d, fx);
      if (!positive(close) || !positive(rate)) {
        complete = false;
        continue;
      }
      value += h.shares * close * s.quoteScale * rate;
    }
    points.push({ date: d, value, complete });
  }
  // Drop trailing days with no session data yet (today before the close, holidays).
  const lastPriced = Math.max(
    ...Object.values(histories).map((h) => (h?.length ? h.at(-1).date : "")).map((x) => (x ? Date.parse(x) : 0)),
  );
  return points.filter((p) => Date.parse(p.date) <= lastPriced || p.date === sorted[0].date);
}
// EUR value of a stock on a date: the last close on or before it times that day's ECB rate.
const eurOn = (history, stock, date, fx) => {
  const close = closeOn(history, date),
    rate = fxOn(stock.currency, date, fx);
  return positive(close) && positive(rate) ? close * stock.quoteScale * rate : null;
};
// Return of a plan entry since the day it was added, using the latest close.
export function sinceAdded(entry, stock, history, fx) {
  if (!entry.added || !history?.length) return null;
  const base = eurOn(history, stock, entry.added, fx),
    now = eurOn(history, stock, history.at(-1).date, fx);
  return base && now ? (now / base - 1) * 100 : null;
}
// Value of the plan, in EUR, from the day the first stock was added: each entry is
// a virtual buy of its weight at the close of its add date; before that its weight
// sits in cash. Weights apply retroactively, so changing one re-prices the past.
export function draftSeries(draft, stocks, histories, fx, today = day()) {
  const rows = draft
    .map((p) => ({
      stock: stocks.find((s) => s.id === p.id),
      weight: p.weight,
      added: p.added,
      history: histories[p.id] || [],
    }))
    .filter((r) => r.stock && positive(r.weight) && r.added && r.history.length);
  if (!rows.length) return [];
  const start = rows.map((r) => r.added).sort()[0];
  const lastPriced = rows
    .map((r) => r.history.at(-1).date)
    .sort()
    .at(-1);
  const end = [today, lastPriced, END].sort()[0];
  const base = rows.map((r) => eurOn(r.history, r.stock, r.added, fx));
  const cash = 1 - rows.reduce((sum, r) => sum + r.weight, 0) / 100;
  const points = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    let value = cash,
      complete = true;
    rows.forEach((r, i) => {
      if (r.added > d || base[i] === null) {
        value += r.weight / 100;
        if (r.added <= d) complete = false;
        return;
      }
      const now = eurOn(r.history, r.stock, d, fx);
      if (now === null) {
        complete = false;
        value += r.weight / 100;
        return;
      }
      value += ((r.weight / 100) * now) / base[i];
    });
    points.push({ date: d, value: value * CAPITAL, complete });
  }
  return points;
}
